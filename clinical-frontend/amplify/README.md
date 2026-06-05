# Amplify Gen 2 Backend Configuration

## Overview

This Amplify Gen 2 backend provides:
- **Authentication**: Amazon Cognito with two user groups (MedicalStaff, Psychologist)
- **API**: AWS AppSync GraphQL API
- **Database**: Amazon DynamoDB with four core models

## Data Models

### 1. PatientRecord
Basic patient demographics and metadata.

**Fields:**
- `patientId`: Unique patient identifier
- `firstName`, `lastName`: Patient name
- `dateOfBirth`: Patient's date of birth
- `phoneNumber`, `email`: Contact information
- `region`: Bahrain or KSA

**Relationships:**
- Has many `ClinicalInteraction` records
- Has many `PatientSummary` records

### 2. ClinicalInteraction
Stores audio recordings, transcripts, and interaction metadata.

**Fields:**
- `interactionId`: Unique interaction identifier
- `audioS3Uri`: S3 URI for call recording
- `transcriptText`: Raw transcript from Amazon Transcribe Medical
- `channel`: Voice, WhatsApp, or WebChat
- `startTime`, `endTime`, `duration`: Timing information
- `connectContactId`: Amazon Connect contact ID
- `agentId`: Medical staff or psychologist who handled the call

**Relationships:**
- Belongs to `PatientRecord`
- Has many `ClinicalEntities` records

### 3. ClinicalEntities
Structured medical entities extracted by AWS Comprehend Medical.

**Fields:**
- `entityId`: Unique entity identifier
- `entitiesJson`: Full JSON output from Comprehend Medical
- `symptoms`: Array of detected symptoms
- `medications`: Array of mentioned medications
- `conditions`: Array of medical conditions
- `procedures`: Array of mentioned procedures
- `comprehendJobId`: AWS Comprehend Medical job ID

**Relationships:**
- Belongs to `ClinicalInteraction`

### 4. PatientSummary
AI-generated summaries and diagnostic suggestions from Strands Agents.

**Fields:**
- `summaryId`: Unique summary identifier
- `summaryText`: Generated summary from Strands Agents
- `diagnosticSuggestions`: Array of suggested diagnoses
- `riskLevel`: Low, Medium, High (for psychological risk assessment)
- `agentType`: summarization-agent or diagnostic-agent
- `embeddingId`: Reference to OpenSearch vector embedding
- `similarCasesCount`: Number of similar historical cases found

**Relationships:**
- Belongs to `PatientRecord`

## Authorization

All models are restricted to authenticated users in the following groups:
- **MedicalStaff**: Doctors, Nurses
- **Psychologist**: Mental health professionals

## Deployment

### Local Development (Sandbox)

Start a local Amplify sandbox environment:

```bash
cd clinical-frontend
npx ampx sandbox
```

This will:
1. Deploy the backend to AWS (using your default AWS profile)
2. Generate the `amplify_outputs.json` file
3. Watch for changes and auto-deploy

### Production Deployment

Deploy to production:

```bash
npx ampx pipeline-deploy --branch main --app-id <your-app-id>
```

## Frontend Integration

### 1. Configure Amplify in your React app

```typescript
// src/main.tsx
import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json';

Amplify.configure(outputs);
```

### 2. Generate a Data client

```typescript
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';

const client = generateClient<Schema>();
```

### 3. Example: Create a patient record

```typescript
const newPatient = await client.models.PatientRecord.create({
  patientId: 'PAT-12345',
  firstName: 'Ahmed',
  lastName: 'Al-Mansoori',
  dateOfBirth: '1985-03-15',
  phoneNumber: '+973-1234-5678',
  email: 'ahmed@example.com',
  region: 'Bahrain',
});
```

### 4. Example: Query clinical interactions

```typescript
const { data: interactions } = await client.models.ClinicalInteraction.list({
  filter: {
    patientRecordId: { eq: 'patient-id' }
  }
});
```

### 5. Example: Subscribe to real-time updates

```typescript
const subscription = client.models.PatientSummary.onCreate().subscribe({
  next: (data) => {
    console.log('New summary created:', data);
  },
  error: (error) => console.error('Subscription error:', error),
});

// Cleanup
subscription.unsubscribe();
```

## User Group Management

### Add a user to a group (AWS CLI)

```bash
# Add user to MedicalStaff group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <your-user-pool-id> \
  --username <user-email> \
  --group-name MedicalStaff

# Add user to Psychologist group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <your-user-pool-id> \
  --username <user-email> \
  --group-name Psychologist
```

### Check user groups in frontend

```typescript
import { fetchAuthSession } from 'aws-amplify/auth';

const session = await fetchAuthSession();
const groups = session.tokens?.accessToken.payload['cognito:groups'] || [];

if (groups.includes('MedicalStaff')) {
  console.log('User is medical staff');
}
```

## Next Steps

1. **Start the sandbox**: `npx ampx sandbox`
2. **Create test users**: Use AWS Cognito console or CLI
3. **Assign users to groups**: Use the CLI commands above
4. **Test the API**: Use the GraphQL explorer in AWS AppSync console
5. **Integrate with frontend**: Follow the frontend integration examples above

## Region Configuration

By default, Amplify will deploy to your AWS profile's default region. For this project:
- **Recommended regions**: `eu-central-1` (Frankfurt) or `us-east-1`
- Amazon Connect and Bedrock services should be deployed to these regions
- Edge resources can be placed closer to Bahrain/KSA users

To specify a region, set it in your AWS profile or use:

```bash
export AWS_REGION=eu-central-1
npx ampx sandbox
```
