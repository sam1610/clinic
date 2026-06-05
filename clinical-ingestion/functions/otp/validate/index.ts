/**
 * clinical-otp-validate
 *
 * Called by Flow 03 to validate the submitted OTP.
 * Increments attempt counter; blocks after 3 failures.
 *
 * Returns:
 *   otpValid:     "true" | "false"
 *   blocked:      "true" | "false"
 *   sessionToken: string (when valid)
 *   authTimestamp: ISO string (when valid)
 */

import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const OTP_TABLE    = process.env.OTP_TABLE || 'ClinicalOTP';
const MAX_ATTEMPTS = 3;

export const handler = async (event: {
  patientId:     string;
  submittedCode: string;
  contactId:     string;
}) => {
  console.log('OTP Validate:', JSON.stringify(event));

  const { patientId, submittedCode, contactId } = event;

  try {
    // Fetch OTP record
    const res = await dynamo.send(new GetItemCommand({
      TableName: OTP_TABLE,
      Key: { patientId: { S: patientId }, contactId: { S: contactId } },
    }));

    const item = res.Item;

    if (!item) {
      console.warn('No OTP record found');
      return { otpValid: 'false', blocked: 'false' };
    }

    const storedOtp   = item.otp?.S || '';
    const attempts    = parseInt(item.attempts?.N || '0', 10);
    const ttl         = parseInt(item.ttl?.N || '0', 10);
    const sessionToken = item.sessionToken?.S || '';

    // Check if blocked
    if (attempts >= MAX_ATTEMPTS) {
      return { otpValid: 'false', blocked: 'true' };
    }

    // Check TTL
    if (Math.floor(Date.now() / 1000) > ttl) {
      return { otpValid: 'false', blocked: 'false' };
    }

    // Validate OTP
    if (submittedCode === storedOtp) {
      // Mark as used
      await dynamo.send(new UpdateItemCommand({
        TableName: OTP_TABLE,
        Key: { patientId: { S: patientId }, contactId: { S: contactId } },
        UpdateExpression: 'SET attempts = :max',
        ExpressionAttributeValues: { ':max': { N: String(MAX_ATTEMPTS) } },
      }));

      const authTimestamp = new Date().toISOString();
      return { otpValid: 'true', blocked: 'false', sessionToken, authTimestamp };
    }

    // Increment failed attempts
    await dynamo.send(new UpdateItemCommand({
      TableName: OTP_TABLE,
      Key: { patientId: { S: patientId }, contactId: { S: contactId } },
      UpdateExpression: 'SET attempts = attempts + :one',
      ExpressionAttributeValues: { ':one': { N: '1' } },
    }));

    const newAttempts = attempts + 1;
    return {
      otpValid: 'false',
      blocked: newAttempts >= MAX_ATTEMPTS ? 'true' : 'false',
    };

  } catch (err) {
    console.error('OTP Validate error:', err);
    return { otpValid: 'false', blocked: 'false' };
  }
};
