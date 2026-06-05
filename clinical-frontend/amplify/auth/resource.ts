import { defineAuth } from '@aws-amplify/backend';

/**
 * Define and configure your auth resource
 * Amazon Cognito authentication with two user groups:
 * - MedicalStaff: Doctors, Nurses
 * - Psychologist: Mental health professionals
 * 
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['MedicalStaff', 'Psychologist'],
});
