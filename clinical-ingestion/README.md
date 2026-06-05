# Clinical Ingestion Stack

AWS CDK stack for processing clinical audio recordings through Amazon Transcribe Medical and AWS Comprehend Medical, with automatic storage in DynamoDB.

## Architecture

```
Amazon Connect Call Recording
         ↓
    S3 Bucket (encrypted)
         ↓
    EventBridge Rule
         ↓
Lambda: Transcribe Medical
         ↓
Amazon Transcribe Medical Job
         ↓
    EventBridge Rule
         ↓
Lambda: Comprehend Medical
         ↓
AWS Comprehend Medical API
         ↓
    DynamoDB Tables
    (ClinicalInteraction + ClinicalEntities)
```

## Components

### 1. S3 Bucket: Call Recordings
- **Purpose**: Secure storage for Amazon Connect call recordings
- **Encryption**: S3-managed server-side encryption (SSE-S3)
- **Lifecycle**: 7-year retention (HIPAA compliance)
- **Versioning**: Enabled
- **Public Access**: Blocked

### 2. Lambda: Transcribe Medical
- **Trigger**: EventBridge rule on S3 object creation
- **Function**: Initiates Amazon Transcribe Medical jobs
- **Input**: S3 URI of audio recording
- **Output**: Transcript JSON in S3
- **Configuration**:
  - Language: en-US
  - Specialty: PRIMARYCARE
  - Type: CONVERSATION
  - Speaker Labels: Enabled (2 speakers)

### 3. Lambda: Comprehend Medical
- **Trigger**: EventBridge rule on Transcribe job completion
- **Function**: Extracts medical entities and writes to DynamoDB
- **Input**: Transcript JSON from S3
- **Output**: Records in DynamoDB tables
- **Entities Extracted**:
  - Symptoms (MEDICAL_CONDITION)
  - Medications (MEDICATION)
  - Procedures (PROCEDURE)
  - Diagnoses (DX_NAME)

### 4. EventBridge Rules
- **Rule 1**: S3 Object Created → Transcribe Lambda
- **Rule 2**: Transcribe Job Complete → Comprehend Lambda

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **AWS CLI** configured
3. **Node.js** 18.x or later
4. **AWS CDK** CLI installed globally
5. **Amplify Gen 2 Backend** deployed (for DynamoDB table names)

## Installation

### 1. Install Dependencies

```bash
cd clinical-ingestion
npm install
```

### 2. Install Lambda Function Dependencies

```bash
# Transcribe Medical function
cd functions/transcribe-medical
npm install
npm run build
cd ../..

# Comprehend Medical function
cd functions/comprehend-medical
npm install
npm run build
cd ../..
```

### 3. Bootstrap CDK (First Time Only)

```bash
npx cdk bootstrap aws://<account-id>/<region>
```

## Configuration

### Get DynamoDB Table Names from Amplify

After deploying your Amplify Gen 2 backend, get the table names:

```bash
# From clinical-frontend directory
npx ampx sandbox

# Check amplify_outputs.json for table names
# Or use AWS Console → DynamoDB → Tables
```

Table names follow this format:
- `ClinicalInteraction-<amplify-app-id>-<branch>`
- `ClinicalEntities-<amplify-app-id>-<branch>`

### Update Stack Configuration

Edit `bin/clinical-ingestion.ts` to add table names:

```typescript
new ClinicalIngestionStack(app, 'ClinicalIngestionStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-central-1',
  },
  clinicalInteractionTableName: 'ClinicalInteraction-abc123-main',
  clinicalEntitiesTableName: 'ClinicalEntities-abc123-main',
});
```

## Deployment

### 1. Synthesize CloudFormation Template

```bash
npm run synth
```

### 2. Review Changes

```bash
npm run diff
```

### 3. Deploy Stack

```bash
npm run deploy
```

This will:
- Create S3 bucket for recordings
- Deploy Lambda functions
- Create EventBridge rules
- Set up IAM permissions

### 4. Note the Outputs

After deployment, note the stack outputs:
- `RecordingsBucketName`: S3 bucket for recordings
- `TranscribeFunctionArn`: Transcribe Lambda ARN
- `ComprehendFunctionArn`: Comprehend Lambda ARN

## Testing

### 1. Upload a Test Recording

```bash
# Get bucket name from stack outputs
BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name ClinicalIngestionStack \
  --query 'Stacks[0].Outputs[?OutputKey==`RecordingsBucketName`].OutputValue' \
  --output text)

# Upload a test audio file
aws s3 cp test-recording.wav s3://$BUCKET_NAME/recordings/test-contact-123/recording.wav
```

### 2. Monitor Lambda Execution

```bash
# Watch Transcribe Lambda logs
aws logs tail /aws/lambda/clinical-transcribe-medical --follow

# Watch Comprehend Lambda logs
aws logs tail /aws/lambda/clinical-comprehend-medical --follow
```

### 3. Verify DynamoDB Records

```bash
# Check ClinicalInteraction table
aws dynamodb scan --table-name <your-clinical-interaction-table>

# Check ClinicalEntities table
aws dynamodb scan --table-name <your-clinical-entities-table>
```

## Audio Format Requirements

Amazon Transcribe Medical supports:
- **Formats**: WAV, MP3, MP4, FLAC, OGG, AMR, WebM
- **Sample Rate**: 8000 Hz to 48000 Hz
- **Channels**: Mono or Stereo
- **Max File Size**: 2 GB
- **Max Duration**: 4 hours

For Amazon Connect:
- Default format: WAV, 8000 Hz, Mono
- Configure in Amazon Connect → Contact Flows → Set recording behavior

## Cost Estimation

### Per 1000 Minutes of Audio

- **S3 Storage**: ~$0.023/GB/month
- **Transcribe Medical**: ~$150 (CONVERSATION type)
- **Comprehend Medical**: ~$10 (DetectEntitiesV2)
- **Lambda**: ~$0.20 (with 512MB/1024MB memory)
- **DynamoDB**: ~$1.25 (on-demand pricing)

**Total**: ~$161.48 per 1000 minutes

## Integration with Amazon Connect

### 1. Configure Connect to Store Recordings in S3

In Amazon Connect Console:
1. Go to **Data Storage** → **Call Recordings**
2. Select your recordings bucket
3. Set prefix: `recordings/`
4. Enable encryption

### 2. Update Contact Flow

Add "Set recording behavior" block:
- Enable recording
- Set recording location: S3 bucket

### 3. Pass Contact Attributes

In your contact flow, set attributes:
- `contactId`: Contact ID
- `patientId`: Patient identifier
- `agentId`: Agent identifier

These will be used to link recordings to patient records.

## Monitoring

### CloudWatch Metrics

- **Lambda Invocations**: Number of function executions
- **Lambda Errors**: Failed executions
- **Lambda Duration**: Execution time
- **Transcribe Jobs**: Job status (COMPLETED, FAILED)

### CloudWatch Alarms

Create alarms for:
- Lambda errors > 5 in 5 minutes
- Transcribe job failures
- DynamoDB write throttling

### CloudWatch Logs

- `/aws/lambda/clinical-transcribe-medical`
- `/aws/lambda/clinical-comprehend-medical`
- `/aws/transcribe/medical-transcription-*`

## Troubleshooting

### Issue: Lambda timeout

**Solution**: Increase timeout in `lib/clinical-ingestion-stack.ts`:
```typescript
timeout: cdk.Duration.seconds(300),
```

### Issue: Transcribe job fails

**Possible causes**:
- Unsupported audio format
- File too large (>2GB)
- Invalid S3 URI
- Insufficient permissions

**Solution**: Check CloudWatch logs and verify audio format.

### Issue: DynamoDB write fails

**Possible causes**:
- Table doesn't exist
- Incorrect table name
- Insufficient IAM permissions

**Solution**: Verify table names and IAM policies.

### Issue: EventBridge rule not triggering

**Solution**: Verify EventBridge notifications are enabled on S3 bucket:
```typescript
this.recordingsBucket.enableEventBridgeNotification();
```

## Security

### Encryption
- **S3**: Server-side encryption (SSE-S3)
- **DynamoDB**: Encryption at rest (AWS managed keys)
- **Lambda**: Environment variables encrypted with AWS managed keys

### IAM Permissions
- Lambda functions use least-privilege IAM roles
- S3 bucket blocks all public access
- DynamoDB tables restricted to Lambda execution roles

### HIPAA Compliance
- 7-year retention policy on recordings
- Encryption at rest and in transit
- Audit logging via CloudTrail
- Access controls via IAM

## Cleanup

To delete all resources:

```bash
npm run destroy
```

**Warning**: This will delete:
- S3 bucket (if empty)
- Lambda functions
- EventBridge rules
- IAM roles

DynamoDB tables created by Amplify will NOT be deleted.

## Next Steps

1. ✅ Deploy Clinical Ingestion Stack
2. ⏭️ Configure Amazon Connect integration
3. ⏭️ Build Agentic Engine (Strands SDK)
4. ⏭️ Create React UI for real-time monitoring
5. ⏭️ Set up OpenSearch for vector search

## Useful Commands

```bash
# Synthesize CloudFormation template
npm run synth

# Compare deployed stack with current state
npm run diff

# Deploy stack
npm run deploy

# Destroy stack
npm run destroy

# Watch for changes
npm run watch

# Build Lambda functions
cd functions/transcribe-medical && npm run build
cd functions/comprehend-medical && npm run build
```

## Support

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Amazon Transcribe Medical](https://docs.aws.amazon.com/transcribe/latest/dg/medical-transcription.html)
- [AWS Comprehend Medical](https://docs.aws.amazon.com/comprehend-medical/)
- [Amazon Connect](https://docs.aws.amazon.com/connect/)
