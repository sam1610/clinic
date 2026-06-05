/**
 * clinical-otp-generate
 *
 * Called by Flow 03 (AuthenticatedPatientFlow) to:
 *  1. Generate a random 6-digit OTP.
 *  2. Store it in DynamoDB with a 5-minute TTL.
 *  3. Send it via Amazon SNS (SMS) to the patient's phone.
 *
 * Returns: { otpSent: "true" | "false" }
 */

import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const sns    = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });

const OTP_TABLE = process.env.OTP_TABLE || 'ClinicalOTP';

export const handler = async (event: {
  patientId:    string;
  patientPhone: string;
  contactId:    string;
}) => {
  console.log('OTP Generate:', JSON.stringify(event));

  const { patientId, patientPhone, contactId } = event;

  // 6-digit OTP
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const ttl = Math.floor(Date.now() / 1000) + 300; // 5 minutes
  const sessionToken = `sess_${contactId}_${Date.now()}`;

  try {
    // Store OTP in DynamoDB
    await dynamo.send(new PutItemCommand({
      TableName: OTP_TABLE,
      Item: {
        patientId:    { S: patientId },
        contactId:    { S: contactId },
        otp:          { S: otp },
        attempts:     { N: '0' },
        ttl:          { N: String(ttl) },
        sessionToken: { S: sessionToken },
        createdAt:    { S: new Date().toISOString() },
      },
    }));

    // Send SMS via SNS
    const message = `Your DigiCall Clinic verification code is: ${otp}\nValid for 5 minutes. Do not share this code.`;

    await sns.send(new PublishCommand({
      PhoneNumber: patientPhone,
      Message: message,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: 'Transactional',
        },
        'AWS.SNS.SMS.SenderID': {
          DataType: 'String',
          StringValue: 'DigiCall',
        },
      },
    }));

    console.log(`OTP sent to ${patientPhone} for patient ${patientId}`);
    return { otpSent: 'true' };

  } catch (err) {
    console.error('OTP Generate error:', err);
    return { otpSent: 'false' };
  }
};
