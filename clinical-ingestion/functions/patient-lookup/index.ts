/**
 * PatientLookup Lambda
 *
 * Called by Connect flows to look up a patient by phone number.
 * Also handles utility actions: UPDATE_INTERACTION_STATUS, VERIFY_SUPERVISOR.
 *
 * Returns:
 *   patientFound: "true" | "false"
 *   patientId, riskLevel, hasActivePrescriptions (when found)
 */
import { DynamoDBClient, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { ConnectClient, DescribeUserCommand } from '@aws-sdk/client-connect';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });

const PATIENT_RECORD_TABLE = process.env.PATIENT_RECORD_TABLE!;
const CLINICAL_INTERACTION_TABLE = process.env.CLINICAL_INTERACTION_TABLE!;
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID!;

export const handler = async (event: Record<string, string>) => {
  console.log('PatientLookup event:', JSON.stringify(event));

  const action = event.action;

  // ── Utility: update interaction status ──────────────────────────────
  if (action === 'UPDATE_INTERACTION_STATUS') {
    await dynamo.send(new UpdateItemCommand({
      TableName: CLINICAL_INTERACTION_TABLE,
      Key: { id: { S: event.interactionId } },
      UpdateExpression: 'SET #status = :s, updatedAt = :t',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':s': { S: event.status || 'ENDED' },
        ':t': { S: new Date().toISOString() },
      },
    }));
    return { updated: true };
  }

  // ── Utility: verify supervisor role ─────────────────────────────────
  if (action === 'VERIFY_SUPERVISOR') {
    try {
      const userId = event.agentArn?.split('/').pop() ?? '';
      const res = await connect.send(new DescribeUserCommand({
        InstanceId: CONNECT_INSTANCE_ID,
        UserId: userId,
      }));
      const profile = res.User?.SecurityProfileIds ?? [];
      // If user has any security profile, treat as supervisor for now
      return { isSupervisor: profile.length > 0 ? 'true' : 'false' };
    } catch {
      return { isSupervisor: 'false' };
    }
  }

  // ── Default: look up patient by phone number ─────────────────────────
  const phone = event.patientPhone ?? '';

  if (!phone) {
    return { patientFound: 'false' };
  }

  try {
    // Scan for patient with matching phone number
    // In production, use a GSI on phoneNumber for O(1) lookup
    const result = await dynamo.send(new ScanCommand({
      TableName: PATIENT_RECORD_TABLE,
      FilterExpression: 'phoneNumber = :ph',
      ExpressionAttributeValues: { ':ph': { S: phone } },
      Limit: 1,
    }));

    if (!result.Items?.length) {
      return { patientFound: 'false' };
    }

    const patient = result.Items[0];
    return {
      patientFound: 'true',
      patientId: patient.id?.S ?? patient.patientId?.S ?? 'UNKNOWN',
      riskLevel: patient.riskLevel?.S ?? 'LOW',
      hasActivePrescriptions: patient.hasActivePrescriptions?.BOOL ? 'true' : 'false',
    };
  } catch (err) {
    console.error('PatientLookup error:', err);
    return { patientFound: 'false' };
  }
};
