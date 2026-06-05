# Technology Stack

## Build System & Package Management
- Frontend: Vite, npm/pnpm
- Backend Infrastructure: AWS CDK (TypeScript)
- Agentic Backend: `uv` for Python package management

## Frameworks & Libraries
- **Frontend:** React, AWS Amplify Gen 2 (`aws-amplify`), `amazon-connect-streams` (for Call Control Panel)
- **API Layer:** AWS AppSync (GraphQL)
- **Database:** Amazon DynamoDB, Amazon OpenSearch Serverless (Vector Store)
- **AI/Agents:** Strands Agents SDK, Amazon Bedrock, AWS Comprehend Medical, Amazon Transcribe Medical

## Development Environment
- Operating System: macOS
- Shell: zsh

## Common Commands
### Build & Deploy
```bash
npx @aws/agentcore deploy  # Deploy Strands Agents
npx ampx sandbox           # Local Amplify Gen 2 sandbox