/**
 * SaveHistoricalInteraction
 *
 * Triggered by EventBridge when Amazon Connect emits a Contact Trace Record.
 *
 * Responsibilities:
 *  1. Parse the CTR for Contact Lens analysis (summary, sentiment, categories).
 *  2. Write a HistoricalInteraction record to the Amplify DynamoDB table.
 *
 * CTR structure reference:
 *   https://docs.aws.amazon.com/connect/latest/adminguide/ctr-data-model.html
 *
 * Contact Lens summary is found at:
 *   detail.ContactLensData.ContactSummary.PostContactSummary.Content
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeEvent } from 'aws-lambda';

const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
);

const TABLE = process.env.HISTORICAL_INTERACTION_TABLE!;

// ── CTR Shape (relevant fields only) ──────────────────────────────────────
interface CTRDetail {
  ContactId: string;
  Channel: 'VOICE' | 'CHAT' | 'TASK';
  InitiationMethod: string;
  ConnectedToSystemTimestamp?: string;
  DisconnectTimestamp?: string;
  Queue?: {
    Name: string;
    ARN: string;
  };
  Agent?: {
    ARN: string;
    Username: string;
    HierarchyGroups?: unknown;
  };
  Attributes?: Record<string, string>;
  CustomerEndpoint?: {
    Address: string;
    Type: string;
  };
  ContactLensData?: {
    ContactSummary?: {
      PostContactSummary?: {
        Content: string;
        Status: string;
      };
    };
    ConversationCharacteristics?: {
      Sentiment?: {
        OverallSentiment?: {
          DetailedSentiment: {
            AGENT: string;
            CUSTOMER: string;
          };
        };
      };
      Categories?: {
        MatchedCategories: string[];
      };
      TalkTime?: {
        TotalTalkTimeMillis: number;
      };
    };
  };
  RecordingLocation?: string;
}

export const handler = async (
  event: EventBridgeEvent<'Amazon Connect Contact Trace Record', CTRDetail>
): Promise<void> => {
  console.log('CTR event received:', JSON.stringify(event, null, 2));

  const ctr = event.detail;

  if (!ctr?.ContactId) {
    console.warn('CTR has no ContactId — skipping');
    return;
  }

  // Extract Contact Lens summary (may be absent if Contact Lens not enabled)
  const contactLens = ctr.ContactLensData;
  const summary =
    contactLens?.ContactSummary?.PostContactSummary?.Content ?? '';

  // Extract sentiment
  const sentiment =
    contactLens?.ConversationCharacteristics?.Sentiment?.OverallSentiment
      ?.DetailedSentiment ?? null;

  // Extract matched clinical categories (configured in Contact Lens rules)
  const categories =
    contactLens?.ConversationCharacteristics?.Categories?.MatchedCategories ?? [];

  // Extract risk level from contact attributes (set by our Connect flows)
  const riskLevel = ctr.Attributes?.riskLevel ?? 'UNKNOWN';
  const patientId  = ctr.Attributes?.patientId  ?? 'UNKNOWN';
  const channelType = ctr.Attributes?.channelType ?? ctr.Channel;

  // Build duration in seconds
  const startTs = ctr.ConnectedToSystemTimestamp
    ? new Date(ctr.ConnectedToSystemTimestamp).getTime()
    : null;
  const endTs = ctr.DisconnectTimestamp
    ? new Date(ctr.DisconnectTimestamp).getTime()
    : null;
  const durationSeconds =
    startTs && endTs ? Math.round((endTs - startTs) / 1000) : null;

  const item = {
    id:               `HI-${ctr.ContactId}`,
    contactId:        ctr.ContactId,
    patientId,
    channelType,
    queueName:        ctr.Queue?.Name ?? 'UNKNOWN',
    agentUsername:    ctr.Agent?.Username ?? 'IVR',
    riskLevel,
    // Contact Lens outputs
    contactLensSummary:  summary,
    sentimentAgent:      sentiment?.AGENT ?? null,
    sentimentCustomer:   sentiment?.CUSTOMER ?? null,
    matchedCategories:   categories,
    // Timing
    startTime:           ctr.ConnectedToSystemTimestamp ?? null,
    endTime:             ctr.DisconnectTimestamp ?? null,
    durationSeconds,
    // Recording
    recordingS3Key:      ctr.RecordingLocation ?? null,
    // Metadata
    customerPhone:       ctr.CustomerEndpoint?.Address ?? null,
    createdAt:           new Date().toISOString(),
    updatedAt:           new Date().toISOString(),
    __typename:          'HistoricalInteraction',
  };

  try {
    await dynamo.send(new PutCommand({ TableName: TABLE, Item: item }));
    console.log(`✅ Saved HistoricalInteraction: ${item.id}`);
  } catch (err) {
    console.error('DynamoDB write failed:', err);
    throw err; // rethrow so EventBridge retries
  }
};
