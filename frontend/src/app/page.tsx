'use client';

import { useQuery, useSubscription, useMutation, gql } from '@apollo/client';
import { useAuthenticationStatus, useNhostClient, useUserData } from '@nhost/nextjs';
import { useState, useEffect } from 'react';

// --- GRAPHQL QUERIES & MUTATIONS ---
const GET_WORKFLOWS = gql`
  query GetWorkflows {
    workflows(order_by: { created_at: desc }) {
      id
      name
      organization {
        quota_used
        quota_allowed
      }
      workflow_steps(order_by: { order_index: asc }) {
        id
        type
      }
    }
  }
`;

const SUBSCRIBE_RUNS = gql`
  subscription StreamRuns($workflowId: uuid!) {
    workflow_runs(where: { workflow_id: { _eq: $workflowId } }, order_by: { created_at: desc }, limit: 1) {
      id
      status
      step_runs(order_by: { created_at: asc }) {
        id
        step_id
        status
        output_data
      }
    }
  }
`;

const RUN_WORKFLOW = gql`
  mutation Run($id: uuid!) {
    triggerWorkflowRun(workflow_id: $id) {
      success
      message
    }
  }
`;

const APPROVE_STEP = gql`
  mutation Approve($step_run_id: uuid!) {
    approveStep(step_run_id: $step_run_id) {
      success
      message
    }
  }
`;

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

export default function Home() {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const nhost = useNhostClient();
  const user = useUserData();
  
  // --- STATE ---
  const [isMounted, setIsMounted] = useState(false);
  const [view, setView] = useState('dashboard'); // Toggles between 'dashboard' and 'builder'
  
  // Login State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  
  // Builder State
  const [workflowName, setWorkflowName] = useState('My Custom AI Pipeline');
  const [steps, setSteps] = useState([{ id: Date.now(), type: 'http_request' }]);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // --- APOLLO HOOKS ---
  const { data: wfData, refetch: refetchWorkflows } = useQuery(GET_WORKFLOWS, { skip: !isAuthenticated });
  const [triggerRun] = useMutation(RUN_WORKFLOW);
  const [approveStep] = useMutation(APPROVE_STEP);
  
  const { data: orgData } = useQuery(GET_MY_ORG, {
    variables: { userId: user?.id },
    skip: !user?.id,
  });
  const [createWorkflow, { loading: isSaving }] = useMutation(CREATE_WORKFLOW);

  useEffect(() => setIsMounted(true), []);

  // Always show the most recently created workflow
  const workflow = wfData?.workflows[0];

  const { data: runData } = useSubscription(SUBSCRIBE_RUNS, {
    variables: { workflowId: workflow?.id },
    skip: !workflow,
  });
  const latestRun = runData?.workflow_runs[0];

  // --- HANDLERS ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    const { error } = await nhost.auth.signIn({ email, password });
    if (error) setLoginError(error.message);
  };

  const addStep = (type: string) => setSteps([...steps, { id: Date.now(), type }]);
  const removeStep = (indexToRemove: number) => setSteps(steps.filter((_, index) => index !== indexToRemove));
  const moveStep = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === steps.length - 1)) return;
    const newSteps = [...steps];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];
    setSteps(newSteps);
  };

  const handleSave = async () => {
    const orgId = orgData?.org_members[0]?.org_id;
    if (!orgId) return alert("Could not find your organization ID!");

    const formattedSteps = steps.map((step, index) => ({
      type: step.type,
      order_index: index
    }));

    try {
      await createWorkflow({
        variables: { name: workflowName, orgId, steps: formattedSteps }
      });
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        refetchWorkflows(); // Refresh dashboard data
        setView('dashboard'); // Auto-return to dashboard
      }, 1500);
    } catch (err) {
      console.error(err);
      alert("Failed to save workflow. Check permissions!");
    }
  };

  // --- RENDER LOGIC ---
  if (!isMounted || isLoading) return <div className="min-h-screen bg-gray-950 flex justify-center items-center text-white">Loading Auth...</div>;

  // 1. LOGIN SCREEN
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-10">
        <div className="bg-gray-900 p-8 rounded-lg border border-gray-800 w-full max-w-md">
          <h1 className="text-2xl font-bold mb-6">Login to Vocallabs AI</h1>
          {loginError && <div className="bg-red-900/50 border border-red-500 text-red-200 p-3 rounded mb-4 text-sm">{loginError}</div>}
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <input type="email" placeholder="Email" className="border border-gray-700 bg-gray-800 p-3 rounded" value={email} onChange={e => setEmail(e.target.value)} />
            <input type="password" placeholder="Password" className="border border-gray-700 bg-gray-800 p-3 rounded" value={password} onChange={e => setPassword(e.target.value)} />
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 font-bold py-3 rounded mt-2">Login</button>
          </form>
        </div>
      </div>
    );
  }

  // 2. BUILDER SCREEN
  if (view === 'builder') {
    return (
      <div className="min-h-screen bg-gray-950 p-10 text-white font-sans">
        <div className="max-w-3xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold">Pipeline Builder</h1>
            <button onClick={() => setView('dashboard')} className="text-blue-400 hover:text-blue-300 font-bold">← Back to Dashboard</button>
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
                  <span className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-700 font-bold">{index + 1}</span>
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
                <button key={type} onClick={() => addStep(type)} className="bg-gray-800 hover:bg-gray-700 text-sm px-4 py-2 rounded-full border border-gray-700">
                  + {type}
                </button>
              ))}
            </div>
            <button onClick={handleSave} disabled={isSaving || steps.length === 0} className={`w-full font-bold py-4 rounded-lg ${saveSuccess ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-500'}`}>
              {saveSuccess ? '✅ Saved Successfully!' : isSaving ? 'Saving...' : '💾 Save Workflow'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. DASHBOARD SCREEN
  return (
    <div className="min-h-screen bg-gray-950 p-10 text-white font-sans">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold">AI Agent Workflow Builder</h1>
          <button 
            onClick={() => setView('builder')}
            className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 px-6 rounded-lg shadow-lg"
          >
            ➕ Build New Workflow
          </button>
        </div>
        
        {workflow ? (
          <div className="border border-gray-700 rounded-xl bg-gray-900 p-8 shadow-xl mb-8">
            <div className="flex justify-between items-center mb-8 border-b border-gray-800 pb-6">
              <div>
                <h2 className="text-3xl font-semibold mb-2">{workflow.name}</h2>
                <div className="flex items-center gap-4 text-sm text-gray-400">
                  <span className="bg-gray-800 px-3 py-1 rounded-full">
                    Quota: {workflow.organization.quota_used} / {workflow.organization.quota_allowed}
                  </span>
                  {latestRun && (
                    <span className="bg-gray-800 px-3 py-1 rounded-full">
                      Last Run Status: <span className="text-blue-400">{latestRun.status}</span>
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => triggerRun({ variables: { id: workflow.id } })} className="bg-green-600 hover:bg-green-500 font-bold py-3 px-8 rounded-lg">
                ▶ Run Workflow
              </button>
            </div>

            <div className="space-y-4">
              <h3 className="text-xl font-medium text-gray-300 mb-4">Pipeline Steps</h3>
              {workflow.workflow_steps.map((step: any, index: number) => {
                const liveStepData = latestRun?.step_runs.find((sr: any) => sr.step_id === step.id);
                return (
                  <div key={step.id} className="p-5 bg-gray-800 border border-gray-700 rounded-lg flex justify-between items-center">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-700 text-sm font-bold">{index + 1}</span>
                      <span className="font-semibold text-lg">{step.type}</span>
                      {liveStepData && (
                        <span className={`ml-4 text-xs font-bold px-3 py-1 rounded-full uppercase ${
                          liveStepData.status === 'completed' ? 'bg-green-900 text-green-300' :
                          liveStepData.status === 'paused_awaiting_approval' ? 'bg-yellow-900 text-yellow-300 animate-pulse' : 'bg-blue-900 text-blue-300'
                        }`}>
                          {liveStepData.status}
                        </span>
                      )}
                    </div>
                    {liveStepData?.status === 'paused_awaiting_approval' && (
                      <button onClick={() => approveStep({ variables: { step_run_id: liveStepData.id } })} className="bg-yellow-600 hover:bg-yellow-500 font-bold px-6 py-2 rounded">
                        Approve & Continue
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="text-center p-12 border border-dashed border-gray-700 rounded-xl bg-gray-900">
            <p className="text-gray-400 text-lg mb-4">No workflows found.</p>
            <button onClick={() => setView('builder')} className="bg-purple-600 hover:bg-purple-500 font-bold py-3 px-8 rounded-lg">Create One Now</button>
          </div>
        )}
      </div>
    </div>
  );
}