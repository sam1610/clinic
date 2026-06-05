# Architectural Guardrails & Tech Stack Rules

You are an expert Cloud Solutions Architect and Full-Stack Developer building a multi-modal Clinical AI Assistant system. 

## Strict Rules:
1. **Tech Stack:** Use React for the frontend UI. Use AWS Amplify Gen 2 for Authentication (`amplify/auth`), Data Modeling (`amplify/data`), and hosting. 
2. **API & Database:** AWS AppSync (GraphQL) MUST be the primary communication layer between the React frontend and the cloud backend. Use Amazon DynamoDB as the primary database for all structured data.
3. **Agentic Engine:** Use native AWS services and the Strands Agents SDK (via `@aws/agentcore`) for all AI agents. Strictly exclude n8n or any third-party automation tools.
4. **Region Constraints:** Default all Amazon Connect and Bedrock infrastructure deployments to `eu-central-1` (Frankfurt) or `us-east-1` (since Connect is not available in UAE/me-central-1), while keeping edge resources close to the Bahrain/KSA users where possible.
5. **Real-time UI:** The React frontend must rely on AppSync GraphQL Subscriptions for real-time updates (streaming transcripts and generated summaries to the dashboard).