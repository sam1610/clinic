# Architectural Guardrails: Hybrid Native AI Architecture

You are an expert Cloud Solutions Architect and Full-Stack Developer. We are refactoring an existing Clinical Management System to a **Hybrid Native AI Architecture** — removing all real-time custom orchestration and relying on AWS-native services for live call handling and asynchronous post-call intelligence.

## Strict Refactoring Rules:

1. **No Real-Time Streaming:** There is strictly no real-time WebSocket or AppSync subscription streaming for transcripts. All live audio and transcript handling is owned entirely by Amazon Connect — never by the frontend or any custom Lambda.

2. **Native Connect Owns Live Calls:** Amazon Connect handles all live call routing, IVR flows, agent transfers, and in-call AI assistance natively (Connect Agent Assist, Contact Lens real-time). No custom Lambda or Step Function may intercept or process a call while it is in progress.

3. **Async Post-Call NLP Pipeline:** All heavy medical NLP (AWS Comprehend Medical) and diagnostic Bedrock inference run **asynchronously and exclusively after the call ends**. The trigger is a Contact Lens `COMPLETED` event via Amazon EventBridge, which invokes an AWS Step Functions state machine. This Step Function orchestrates: recording retrieval → Transcribe Medical → Comprehend Medical → Bedrock diagnostic summary → DynamoDB write.

4. **Static Historical EHR Frontend:** The React frontend (`clinical-frontend`) is a **static historical EHR dashboard only**. It embeds the Amazon Connect CCP (via `amazon-connect-streams`) for agent call control. It reads historical patient records, summaries, and clinical entities from DynamoDB via AppSync GraphQL queries. It does **not** subscribe to live transcript streams or real-time contact events.

5. **Knowledge Base:** Replace the custom OpenSearch stack with a native **Amazon Bedrock Knowledge Base** backed by S3 for case history retrieval.

6. **Region Constraint:** Default all infrastructure to `eu-central-1` or `us-east-1`.
