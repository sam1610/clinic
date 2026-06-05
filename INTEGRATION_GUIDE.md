# Integration Guide: Frontend + Ingestion Stack

## Overview

This guide explains how to integrate the **Clinical Frontend** (Amplify Gen 2) with the **Clinical Ingestion Stack** (AWS CDK).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Amazon Connect                               │
│                  (Call Recording Enabled)                        │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                  S3 Bucket: Call Recordings                      │
│                    (Server-side encrypted)                       │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│              EventBridge: S3 Object Created                      │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│           Lambda: Transcribe Medical (Start Job)                 │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│              Amazon Transcribe Medical                           │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│         EventBridge: Transcribe Job Complete                     │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│      Lambda: Comprehend Medical (Extract + Write)                │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                    DynamoDB Tables                               │
│         (ClinicalInteraction + ClinicalEntities)                 │
│              Created by Amplify Gen 2                            │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                  AppSync GraphQL API                             │
│              (Real-time Subscriptions)                           │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                    React Frontend                                │
│            (Real-time Dashboard + CCP)                           │
└─────────────────────────────────────────────────────────────────┘
```

## Integration Steps

### Step 1: Deploy Amplify Gen 2 Backend

```bash
cd clinical-frontend
npx ampx sandbox
```

This creates:
- Cognito User Pool with groups (MedicalStaff, Psychologist)
- AppSync GraphQL API
- DynamoDB tables (ClinicalInteraction, ClinicalEntities, PatientRecord, PatientSummary)

**Save the table names** from `amplify_outputs.json` or AWS Console.

### Step 2: Configure Clinical Ingestion Stack

Edit `clinical-ingestion/bin/clinical-ingestion.ts`:

```typescript
new ClinicalIngestionStack(app, 'ClinicalIngestionStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-central-1',
  },
  // Add your Amplify table names here
  clinicalInteractionTableName: 'ClinicalInteraction-abc123xyz-main',
  clinicalEntitiesTableName: 'ClinicalEntities-abc123xyz-main',
});
```

### Step 3: Deploy Clinical Ingestion Stack

```bash
cd clinical-ingestion
npm run deploy
```

This creates:
- S3 bucket for recordings
- Lambda functions (Transcribe, Comprehend)
- EventBridge rules
- IAM permissions to write to Amplify DynamoDB tables

**Save the S3 bucket name** from stack outputs.

### Step 4: Configure Amazon Connect

1. Go to **Amazon Connect Console**
2. Select your instance
3. **Data Storage** → **Call Recordings**
4. Set S3 bucket: `clinical-call-recordings-123456789012-eu-central-1`
5. Set prefix: `recordings/`
6. Enable encryption
7. Save

### Step 5: Update Contact Flow

In your Amazon Connect contact flow:

1. Add **Set recording behavior** block
2. Enable recording
3. Set recording location: S3 bucket
4. Connect to your call flow

### Step 6: Test End-to-End

1. **Make a test call** through Amazon Connect
2. **Speak medical terms**: "Patient has headache and fever"
3. **End the call**
4. **Wait 2-3 minutes** for processing
5. **Check DynamoDB** for transcript and entities
6. **Check React app** for real-time updates

## Data Flow

### 1. Call Recording → S3

When a call ends, Amazon Connect uploads the recording:

```
s3://clinical-call-recordings-123456789012-eu-central-1/recordings/contact-abc123/recording.wav
```

### 2. S3 → Transcribe Lambda

EventBridge triggers the Transcribe Lambda:

```typescript
// Event payload
{
  "detail-type": "Object Created",
  "detail": {
    "bucket": { "name": "clinical-call-recordings-..." },
    "object": { "key": "recordings/contact-abc123/recording.wav" }
  }
}
```

### 3. Transcribe Lambda → Transcribe Medical

Lambda starts a Transcribe Medical job:

```typescript
{
  "MedicalTranscriptionJobName": "medical-transcription-...",
  "LanguageCode": "en-US",
  "MediaFormat": "wav",
  "Media": { "MediaFileUri": "s3://..." },
  "Specialty": "PRIMARYCARE",
  "Type": "CONVERSATION"
}
```

### 4. Transcribe Medical → Comprehend Lambda

When job completes, EventBridge triggers Comprehend Lambda:

```typescript
// Event payload
{
  "detail-type": "Transcribe Medical Job State Change",
  "detail": {
    "TranscriptionJobName": "medical-transcription-...",
    "TranscriptionJobStatus": "COMPLETED",
    "OutputDataConfig": { "S3Uri": "s3://..." }
  }
}
```

### 5. Comprehend Lambda → DynamoDB

Lambda writes to both tables:

**ClinicalInteraction**:
```json
{
  "id": "INT-1234567890",
  "interactionId": "INT-1234567890",
  "patientRecordId": "UNKNOWN",
  "audioS3Uri": "s3://bucket/recordings/contact-abc123/recording.wav",
  "transcriptText": "Patient reports headache and fever...",
  "channel": "Voice",
  "connectContactId": "contact-abc123"
}
```

**ClinicalEntities**:
```json
{
  "id": "ENT-1234567890",
  "entityId": "ENT-1234567890",
  "clinicalInteractionId": "INT-1234567890",
  "symptoms": ["headache", "fever"],
  "medications": [],
  "conditions": [],
  "procedures": []
}
```

### 6. DynamoDB → AppSync → React

AppSync subscriptions notify the React frontend in real-time:

```typescript
// In React component
const subscription = client.models.ClinicalInteraction.onCreate().subscribe({
  next: (data) => {
    console.log('New interaction:', data);
    // Update UI with new transcript
  },
});
```

## Real-Time Updates in React

### Subscribe to New Interactions

```typescript
import { useEffect, useState } from 'react';
import { client } from './lib/amplify-client';

export function InteractionMonitor() {
  const [interactions, setInteractions] = useState([]);

  useEffect(() => {
    // Subscribe to new interactions
    const subscription = client.models.ClinicalInteraction.onCreate().subscribe({
      next: (newInteraction) => {
        console.log('New interaction received:', newInteraction);
        setInteractions((prev) => [newInteraction, ...prev]);
      },
      error: (error) => console.error('Subscription error:', error),
    });

    // Cleanup
    return () => subscription.unsubscribe();
  }, []);

  return (
    <div>
      <h2>Recent Interactions</h2>
      {interactions.map((interaction) => (
        <div key={interaction.id}>
          <p><strong>Contact ID:</strong> {interaction.connectContactId}</p>
          <p><strong>Transcript:</strong> {interaction.transcriptText}</p>
        </div>
      ))}
    </div>
  );
}
```

### Subscribe to New Entities

```typescript
useEffect(() => {
  const subscription = client.models.ClinicalEntities.onCreate().subscribe({
    next: (newEntities) => {
      console.log('New entities extracted:', newEntities);
      // Display symptoms, medications, etc.
    },
  });

  return () => subscription.unsubscribe();
}, []);
```

## Linking Interactions to Patients

Currently, the Comprehend Lambda sets `patientRecordId` to `"UNKNOWN"`. To link interactions to patients:

### Option 1: Pass Patient ID from Connect

In your Amazon Connect contact flow:

1. **Get customer input** (patient ID or phone number)
2. **Set contact attributes**:
   - `patientId`: Patient identifier
3. **Store in S3 object metadata**

Update Transcribe Lambda to read metadata:

```typescript
// In transcribe-medical/index.ts
const metadata = await s3Client.send(new HeadObjectCommand({
  Bucket: bucketName,
  Key: objectKey,
}));

const patientId = metadata.Metadata?.patientid || 'UNKNOWN';
```

### Option 2: Lookup by Phone Number

Update Comprehend Lambda to query PatientRecord by phone number:

```typescript
// In comprehend-medical/index.ts
const phoneNumber = extractPhoneFromContactId(contactId);

const patient = await dynamoClient.send(new QueryCommand({
  TableName: 'PatientRecord-...',
  IndexName: 'phoneNumber-index',
  KeyConditionExpression: 'phoneNumber = :phone',
  ExpressionAttributeValues: { ':phone': { S: phoneNumber } },
}));

const patientRecordId = patient.Items?.[0]?.id?.S || 'UNKNOWN';
```

### Option 3: Manual Linking in UI

Allow medical staff to link interactions to patients in the React UI:

```typescript
async function linkInteractionToPatient(interactionId: string, patientId: string) {
  await client.models.ClinicalInteraction.update({
    id: interactionId,
    patientRecordId: patientId,
  });
}
```

## Monitoring the Integration

### CloudWatch Logs

```bash
# Transcribe Lambda
aws logs tail /aws/lambda/clinical-transcribe-medical --follow

# Comprehend Lambda
aws logs tail /aws/lambda/clinical-comprehend-medical --follow
```

### DynamoDB Queries

```bash
# List recent interactions
aws dynamodb scan \
  --table-name ClinicalInteraction-abc123xyz-main \
  --max-items 10

# List recent entities
aws dynamodb scan \
  --table-name ClinicalEntities-abc123xyz-main \
  --max-items 10
```

### AppSync Queries

In AWS AppSync Console:

```graphql
query ListRecentInteractions {
  listClinicalInteractions(limit: 10) {
    items {
      id
      interactionId
      transcriptText
      connectContactId
      createdAt
    }
  }
}

query GetInteractionWithEntities($id: ID!) {
  getClinicalInteraction(id: $id) {
    id
    transcriptText
    entities {
      items {
        symptoms
        medications
        conditions
        procedures
      }
    }
  }
}
```

## Troubleshooting

### Issue: Interactions not appearing in DynamoDB

**Check**:
1. Verify table names in `bin/clinical-ingestion.ts`
2. Check Lambda IAM permissions
3. Review Comprehend Lambda logs

### Issue: Transcribe job fails

**Check**:
1. Audio format (WAV, MP3, MP4, FLAC)
2. Sample rate (8000-48000 Hz)
3. File size (<2GB)
4. S3 permissions

### Issue: Real-time updates not working

**Check**:
1. AppSync subscriptions enabled
2. Cognito authentication working
3. User in correct group (MedicalStaff or Psychologist)

## Security Considerations

### IAM Permissions

The Comprehend Lambda needs write access to Amplify DynamoDB tables:

```typescript
// In lib/clinical-ingestion-stack.ts
this.comprehendFunction.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
    resources: [
      `arn:aws:dynamodb:${this.region}:${this.account}:table/ClinicalInteraction*`,
      `arn:aws:dynamodb:${this.region}:${this.account}:table/ClinicalEntities*`,
    ],
  })
);
```

### Data Encryption

- **S3**: Server-side encryption (SSE-S3)
- **DynamoDB**: Encryption at rest (AWS managed keys)
- **Transit**: HTTPS for all API calls

### Access Control

- **S3 Bucket**: Block all public access
- **DynamoDB**: Group-based authorization via AppSync
- **Lambda**: Least-privilege IAM roles

## Cost Optimization

### Estimated Monthly Cost (1000 calls/month, 5 min avg)

- **S3 Storage**: $0.12 (5GB)
- **Transcribe Medical**: $750 (5000 minutes × $0.15/min)
- **Comprehend Medical**: $50 (entity detection)
- **Lambda**: $10 (invocations + duration)
- **DynamoDB**: $6 (on-demand writes)
- **EventBridge**: $0.50

**Total**: ~$816.62/month

### Optimization Tips

1. **Use Transcribe batch jobs** for non-real-time processing
2. **Enable DynamoDB auto-scaling** for predictable traffic
3. **Reduce Lambda memory** if not needed
4. **Archive old recordings** to S3 Glacier

## Next Steps

1. ✅ Frontend and Ingestion Stack integrated
2. ⏭️ Build Agentic Engine (Strands SDK) for AI summaries
3. ⏭️ Create React UI components (Dashboard, CCP)
4. ⏭️ Set up OpenSearch for vector search
5. ⏭️ Implement patient linking logic
6. ⏭️ Add real-time transcript streaming

## Support

- [Amplify Gen 2 Docs](https://docs.amplify.aws/react/)
- [AWS CDK Docs](https://docs.aws.amazon.com/cdk/)
- [Amazon Connect Docs](https://docs.aws.amazon.com/connect/)
- [Transcribe Medical Docs](https://docs.aws.amazon.com/transcribe/latest/dg/medical-transcription.html)
- [Comprehend Medical Docs](https://docs.aws.amazon.com/comprehend-medical/)
