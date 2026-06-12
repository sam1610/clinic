/**
 * get-transcribe-result
 *
 * Step Functions Task — Step 2 of the Post-Call Processing pipeline.
 *
 * Polls the status of an Amazon Transcribe Medical job. If the job is
 * still in progress, throws a retriable error so the Step Functions
 * Wait + Retry pattern can back off and retry. When the job is COMPLETED,
 * it reads the transcript JSON from S3 and extracts the full text.
 *
 * Input (from transcribe-medical output):
 * {
 *   ...previous state,
 *   transcribeJobName: string,
 *   transcriptOutputBucket: string,
 *   transcriptOutputKey: string
 * }
 *
 * Output:
 * {
 *   ...input (pass-through),
 *   transcriptText: string
 * }
 */
import {
  TranscribeClient,
  GetMedicalTranscriptionJobCommand,
  TranscriptionJobStatus,
} from '@aws-sdk/client-transcribe';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const transcribe = new TranscribeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

/** Thrown when the job is still running — Step Functions will retry */
class TranscribeJobInProgress extends Error {
  constructor(jobName: string, status: string) {
    super(`Transcribe job ${jobName} is ${status}`);
    this.name = 'TranscribeJobInProgress';
  }
}

interface TranscribeResultInput {
  transcribeJobName: string;
  transcriptOutputBucket: string;
  transcriptOutputKey: string;
  [key: string]: unknown;
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', reject);
  });
}

export const handler = async (input: TranscribeResultInput) => {
  const { transcribeJobName, transcriptOutputBucket, transcriptOutputKey } = input;

  console.log(`Checking Transcribe job: ${transcribeJobName}`);

  const { MedicalTranscriptionJob } = await transcribe.send(
    new GetMedicalTranscriptionJobCommand({ MedicalTranscriptionJobName: transcribeJobName })
  );

  const status = MedicalTranscriptionJob?.TranscriptionJobStatus as TranscriptionJobStatus;

  if (status === 'IN_PROGRESS' || status === 'QUEUED') {
    throw new TranscribeJobInProgress(transcribeJobName, status);
  }

  if (status === 'FAILED') {
    const reason = MedicalTranscriptionJob?.FailureReason ?? 'Unknown failure';
    throw new Error(`Transcribe job ${transcribeJobName} FAILED: ${reason}`);
  }

  // status === 'COMPLETED' — read transcript from S3
  console.log(`Job ${transcribeJobName} COMPLETED. Reading transcript from S3.`);

  const s3Response = await s3.send(
    new GetObjectCommand({
      Bucket: transcriptOutputBucket,
      Key: transcriptOutputKey,
    })
  );

  const rawJson = await streamToString(s3Response.Body as NodeJS.ReadableStream);
  const transcript = JSON.parse(rawJson);

  // Amazon Transcribe JSON format: results.transcripts[0].transcript
  const transcriptText: string =
    transcript?.results?.transcripts?.[0]?.transcript ?? '';

  console.log(`Transcript length: ${transcriptText.length} chars`);

  return {
    ...input,
    transcriptText,
  };
};
