Replace the generic monolithic/microservices examples with the exact "Frontend/Backend Separation" required for this project:

```markdown
# Project Structure

## Overview
This project uses a strict Frontend/Backend separation, utilizing AWS Amplify Gen 2 for the client and AWS CDK/AgentCore for the intelligence routing.

## Required Structure

```text
Clinic/
├── .kiro/                      # Kiro configuration and steering files
│   └── steering/               # AI assistant guidance documents
├── clinical-frontend/          # React Workspace
│   ├── src/
│   │   ├── components/         # UI components (Agent Dashboard, CCP)
│   │   └── graphql/            # AppSync queries/mutations/subscriptions
│   └── amplify/                # Amplify Gen 2 backend definitions
│       ├── auth/               # Cognito resource definitions
│       └── data/               # AppSync/DynamoDB schema definitions
├── clinical-ingestion/         # AWS CDK Stack for Audio & Text NLP
│   ├── lib/                    # S3, Transcribe, Comprehend Medical definitions
│   └── functions/              # Lambda event triggers
└── agentic-engine/             # Strands SDK Agents (Python)
    ├── summarization-agent/
    └── diagnostic-agent/