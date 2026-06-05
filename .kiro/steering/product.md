### 4. Update `product.md`
Update this to reflect the actual architecture diagram you provided:

```markdown
# Product Overview

## Multi-Modal Clinical AI Assistant

This project is an advanced clinical management system that integrates real-time communications with native Agentic AI to support medical staff and psychologists in Bahrain and KSA.

## Purpose

The system captures omnichannel patient interactions (Voice via local SIP, WhatsApp, Web Chat), extracts clinical entities in real-time using NLP, and leverages a swarm of AI agents to summarize cases and suggest diagnoses.

## Target Users

- Medical Staff (Doctors, Nurses)
- Psychologists (Monitoring for high-risk psychological markers)
- Patients (Bahrain / KSA)

## Key Capabilities

- **Omnichannel Core:** Ingests audio and text via Amazon Connect and Meta WhatsApp API.
- **NLP & Extraction Pipeline:** Converts speech-to-text via Amazon Transcribe and extracts symptoms/medications using AWS Comprehend Medical.
- **Native Agentic AI Engine:** Uses the Strands SDK to summarize patient interactions and provide diagnostic suggestions.
- **Human-In-The-Loop Frontend:** A React workspace providing real-time call control and instant clinical summaries via AppSync subscriptions.
- **Vectorized Feedback Loop:** Uses Amazon OpenSearch to retrieve historical cases and improve diagnostic accuracy.