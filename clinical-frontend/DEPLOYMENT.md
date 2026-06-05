# Deployment Guide - Clinical Frontend

## Prerequisites

1. **AWS Account**: Ensure you have an AWS account with appropriate permissions
2. **AWS CLI**: Install and configure AWS CLI with your credentials
3. **Node.js**: Version 18.x or later
4. **npm/pnpm**: Package manager

## AWS Configuration

### Set Default Region

For this project, we recommend using `eu-central-1` (Frankfurt) or `us-east-1`:

```bash
# Set AWS region
export AWS_REGION=eu-central-1

# Or configure in AWS CLI
aws configure set region eu-central-1
```

### Verify AWS Credentials

```bash
aws sts get-caller-identity
```

This should return your AWS account ID and user/role information.

## Local Development Setup

### 1. Install Dependencies

```bash
cd clinical-frontend
npm install
```

### 2. Start Amplify Sandbox

The sandbox creates a cloud-based development environment:

```bash
npx ampx sandbox
```

This will:
- Deploy the backend to AWS (Cognito, AppSync, DynamoDB)
- Generate `amplify_outputs.json` with connection details
- Watch for changes and auto-deploy
- Keep running in the background

**Important**: Keep this terminal window open while developing.

### 3. Start Vite Dev Server (New Terminal)

In a new terminal window:

```bash
cd clinical-frontend
npm run dev
```

Your app will be available at `http://localhost:5173`

## Create Test Users

### Option 1: AWS Console

1. Go to AWS Cognito console
2. Find your User Pool (created by Amplify)
3. Create users manually
4. Add users to groups: `MedicalStaff` or `Psychologist`

### Option 2: AWS CLI

```bash
# Get User Pool ID from amplify_outputs.json or AWS Console
USER_POOL_ID="<your-user-pool-id>"

# Create a user
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username doctor@example.com \
  --user-attributes Name=email,Value=doctor@example.com \
  --temporary-password "TempPass123!" \
  --message-action SUPPRESS

# Add user to MedicalStaff group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id $USER_POOL_ID \
  --username doctor@example.com \
  --group-name MedicalStaff

# Create a psychologist user
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username psychologist@example.com \
  --user-attributes Name=email,Value=psychologist@example.com \
  --temporary-password "TempPass123!" \
  --message-action SUPPRESS

# Add user to Psychologist group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id $USER_POOL_ID \
  --username psychologist@example.com \
  --group-name Psychologist
```

## Testing the Backend

### Test GraphQL API (AWS Console)

1. Go to AWS AppSync console
2. Find your API (created by Amplify)
3. Open the "Queries" tab
4. Run test queries:

```graphql
# List all patients
query ListPatients {
  listPatientRecords {
    items {
      id
      patientId
      firstName
      lastName
      region
    }
  }
}

# Create a patient
mutation CreatePatient {
  createPatientRecord(input: {
    patientId: "PAT-001"
    firstName: "Ahmed"
    lastName: "Al-Mansoori"
    dateOfBirth: "1985-03-15"
    phoneNumber: "+973-1234-5678"
    email: "ahmed@example.com"
    region: "Bahrain"
  }) {
    id
    patientId
    firstName
    lastName
  }
}
```

### Test from Frontend

Create a test component:

```typescript
// src/components/TestBackend.tsx
import { useEffect, useState } from 'react';
import { client } from '../lib/amplify-client';

export function TestBackend() {
  const [patients, setPatients] = useState([]);

  useEffect(() => {
    async function fetchPatients() {
      const { data } = await client.models.PatientRecord.list();
      setPatients(data);
    }
    fetchPatients();
  }, []);

  return (
    <div>
      <h2>Patients</h2>
      <ul>
        {patients.map((patient) => (
          <li key={patient.id}>
            {patient.firstName} {patient.lastName} - {patient.region}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## Production Deployment

### Option 1: Amplify Hosting (Recommended)

```bash
# Initialize Amplify app
npx ampx pipeline-deploy --branch main

# Follow the prompts to connect your Git repository
```

### Option 2: Manual Deployment

1. **Build the frontend**:
   ```bash
   npm run build
   ```

2. **Deploy backend**:
   ```bash
   npx ampx deploy --branch production
   ```

3. **Deploy frontend** to your hosting provider (Vercel, Netlify, S3, etc.)

## Environment Variables

For production, you may want to set environment variables:

```bash
# .env.production
VITE_AWS_REGION=eu-central-1
VITE_API_ENDPOINT=<your-appsync-endpoint>
```

## Monitoring and Logs

### CloudWatch Logs

- **AppSync Logs**: AWS AppSync → Your API → Settings → Logging
- **Lambda Logs**: CloudWatch → Log Groups → `/aws/lambda/*`
- **Cognito Logs**: CloudWatch → Log Groups → `/aws/cognito/*`

### Amplify Console

Monitor deployments and backend status:
```bash
npx ampx console
```

## Troubleshooting

### Issue: "amplify_outputs.json not found"

**Solution**: Make sure the sandbox is running:
```bash
npx ampx sandbox
```

### Issue: "User is not authorized"

**Solution**: Verify the user is in the correct group:
```bash
aws cognito-idp admin-list-groups-for-user \
  --user-pool-id $USER_POOL_ID \
  --username user@example.com
```

### Issue: "GraphQL errors"

**Solution**: Check AppSync logs in CloudWatch and verify your schema is deployed:
```bash
npx ampx sandbox --outputs-out-dir ./
```

## Next Steps

1. ✅ Backend configured (Cognito, AppSync, DynamoDB)
2. ⏭️ Create the Clinical Ingestion Stack (CDK)
3. ⏭️ Build the Agentic Engine (Strands SDK)
4. ⏭️ Integrate Amazon Connect
5. ⏭️ Build the React UI components

## Useful Commands

```bash
# Start sandbox
npx ampx sandbox

# Generate GraphQL types
npx ampx generate graphql-client-code

# View backend status
npx ampx sandbox --outputs-out-dir ./

# Delete sandbox (cleanup)
npx ampx sandbox delete
```

## Support

- [Amplify Gen 2 Documentation](https://docs.amplify.aws/react/)
- [AppSync Documentation](https://docs.aws.amazon.com/appsync/)
- [Cognito Documentation](https://docs.aws.amazon.com/cognito/)
