'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery, gql } from '@apollo/client';
import { useAuthenticationStatus, useUserData } from '@nhost/nextjs';

const GET_MY_ORG = gql`
  query GetMyOrg($userId: uuid!) {
    org_members(where: { user_id: { _eq: $userId } }) {
      org_id
    }
  }
`;

const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($name: String!, $orgId: uuid!, $steps: [workflow_steps_insert_input!]!) {
    insert_workflows_one(object: {
      name: $name,
      org_id: $orgId,
      workflow_steps: { data: $steps }
    }) {
      id
    }
  }
`;

const STEP_TYPES = ['llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate'];

export default function Builder() {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const user = useUserData();
  const [isMounted, setIsMounted] = useState(false);
  
  const [workflowName, setWorkflowName] = useState('My New AI Pipeline');
  const [steps, setSteps] = useState([{ id: Date.now(), type: 'http_request' }]);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Get the user's organization ID so we can attach the workflow to it
  const { data: orgData } = useQuery(GET_MY_ORG, {
    variables: { userId: user?.id },
    skip: !user?.id,
  });

  const [createWorkflow, { loading: isSaving }] = useMutation(CREATE_WORKFLOW);

  useEffect(() => setIsMounted(true), []);

  const addStep = (type: string) => {
    setSteps([...steps, { id: Date.now(), type }]);
  };

  const removeStep = (indexToRemove: number) => {
    setSteps(steps.filter((_, index) => index !== indexToRemove));
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === steps.length - 1)) return;
    
    const newSteps = [...steps];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    // Swap the elements
    [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];
    setSteps(newSteps);
  };

  const handleSave = async () => {
    const orgId = orgData?.org_members[0]?.org_id;
    if (!orgId) return alert("Could not find your organization ID!");

    // Format steps for Hasura (adding the order_index so they execute in the right order)
    const formattedSteps = steps.map((step, index) => ({
      type: step.type,
      order_index: index
    }));

    try {
      await createWorkflow({
        variables: {
          name: workflowName,
          orgId: orgId,
          steps: formattedSteps
        }
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      alert("Failed to save workflow. Check permissions!");
    }
  };

  if (!isMounted || isLoading) return <div className="min-h-screen bg-gray-950 text-white p-10">Loading...</div>;
  if (!isAuthenticated) return <div className="min-h-screen bg-gray-950 text-white p-10">Please log in first.</div>;

  return (
    <div className="min-h-screen bg-gray-950 p-10 text-white font-sans">
      <div className="max-w-3xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Pipeline Builder</h1>
          <a href="/" className="text-blue-400 hover:text-blue-300">← Back to Dashboard</a>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 shadow-xl">
          <input
            type="text"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            className="w-full bg-transparent border-b border-gray-700 text-2xl font-bold mb-8 pb-2 focus:outline-none focus:border-blue-500"
            placeholder="Workflow Name"
          />

          <div className="space-y-4 mb-8">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center gap-4 bg-gray-800 p-4 rounded-lg border border-gray-700">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-700 font-bold">
                  {index + 1}
                </span>
                
                <span className="font-mono text-lg flex-1">{step.type}</span>
                
                <div className="flex gap-2">
                  <button onClick={() => moveStep(index, 'up')} className="p-2 hover:bg-gray-700 rounded" disabled={index === 0}>⬆️</button>
                  <button onClick={() => moveStep(index, 'down')} className="p-2 hover:bg-gray-700 rounded" disabled={index === steps.length - 1}>⬇️</button>
                  <button onClick={() => removeStep(index)} className="p-2 text-red-400 hover:bg-gray-700 rounded">❌</button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 mb-8 p-4 bg-gray-950 rounded-lg border border-gray-800">
            <span className="w-full text-sm text-gray-500 mb-2">Add new step:</span>
            {STEP_TYPES.map(type => (
              <button
                key={type}
                onClick={() => addStep(type)}
                className="bg-gray-800 hover:bg-gray-700 text-sm px-4 py-2 rounded-full border border-gray-700 transition-colors"
              >
                + {type}
              </button>
            ))}
          </div>

          <button 
            onClick={handleSave}
            disabled={isSaving || steps.length === 0}
            className={`w-full font-bold py-4 rounded-lg transition-colors ${
              saveSuccess ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {saveSuccess ? '✅ Saved Successfully!' : isSaving ? 'Saving...' : '💾 Save Workflow'}
          </button>
        </div>
      </div>
    </div>
  );
}