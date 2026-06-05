/**
 * Data Example Component
 * 
 * Demonstrates how to use the Amplify Data client to interact with the backend.
 */

import { useState, useEffect } from 'react';
import { client } from '../lib/amplify-client';

export function DataExample() {
  const [patients, setPatients] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch patients on component mount
  useEffect(() => {
    fetchPatients();
  }, []);

  const fetchPatients = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const { data, errors } = await client.models.PatientRecord.list();
      
      if (errors) {
        console.error('GraphQL errors:', errors);
        setError('Failed to fetch patients');
      } else {
        setPatients(data);
      }
    } catch (err) {
      console.error('Error fetching patients:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const createSamplePatient = async () => {
    try {
      const newPatient = await client.models.PatientRecord.create({
        patientId: `PAT-${Date.now()}`,
        firstName: 'Ahmed',
        lastName: 'Al-Mansoori',
        dateOfBirth: '1985-03-15',
        phoneNumber: '+973-1234-5678',
        email: 'ahmed@example.com',
        region: 'Bahrain',
      });

      console.log('Created patient:', newPatient);
      
      // Refresh the list
      await fetchPatients();
    } catch (err) {
      console.error('Error creating patient:', err);
      setError(err instanceof Error ? err.message : 'Failed to create patient');
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 bg-gray-100 rounded">
        <p>Loading patients...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-100 rounded">
        <p className="text-red-700">Error: {error}</p>
        <button
          onClick={fetchPatients}
          className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white rounded shadow">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Patient Records</h2>
        <button
          onClick={createSamplePatient}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          Create Sample Patient
        </button>
      </div>

      {patients.length === 0 ? (
        <p className="text-gray-500">No patients found. Create a sample patient to get started.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Patient ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Region
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contact
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {patients.map((patient) => (
                <tr key={patient.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {patient.patientId}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {patient.firstName} {patient.lastName}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {patient.region}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {patient.email || patient.phoneNumber}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
