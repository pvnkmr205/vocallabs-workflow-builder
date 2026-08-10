import { Request, Response } from 'express';

export default async function handler(req: Request, res: Response) {
  try {
    const { workflow_id } = req.body.input;
    // Extract the user ID from Hasura's secure session variables
    const userId = req.body.session_variables?.['x-hasura-user-id'];
    
    const graphqlUrl = process.env.NHOST_GRAPHQL_URL as string;
    const adminSecret = process.env.NHOST_ADMIN_SECRET as string;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized: Missing User ID" });
    }

    // 1. Fetch Workflow details, Quota, and verify User Role
    const checkRes = await fetch(graphqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret },
      body: JSON.stringify({
        query: `
          query GetWfDetails($workflowId: uuid!, $userId: uuid!) {
            workflows_by_pk(id: $workflowId) {
              organization {
                quota_used
                quota_allowed
                org_members(where: { user_id: { _eq: $userId }, role: { _in: ["owner", "editor"] } }) {
                  id
                }
              }
              workflow_steps(order_by: { order_index: asc }) {
                id
                type
              }
            }
          }
        `,
        variables: { workflowId: workflow_id, userId: userId }
      })
    });
    
    const checkData = await checkRes.json();
    const workflow = checkData.data?.workflows_by_pk;

    if (!workflow) {
      return res.status(404).json({ success: false, message: "Workflow not found." });
    }

    // Layer 2 Security: Check if user is an owner/editor
    const members = workflow.organization.org_members;
    if (!members || members.length === 0) {
      return res.status(403).json({ success: false, message: "Forbidden: You must be an owner or editor to run this workflow." });
    }

    // Quota Check: Ensure they haven't exceeded their limit
    if (workflow.organization.quota_used >= workflow.organization.quota_allowed) {
      return res.status(429).json({ success: false, message: "Quota Exhausted: Upgrade your plan to run more workflows." });
    }

    // 2. Simulate External API Calls (LLM / HTTP)
    // The assignment requires a stubbed delay if a real LLM isn't hooked up
    console.log("Simulating LLM and HTTP requests...");
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2-second artificial delay

    // 3. Map out the run status (Pause if it hits an approval_gate)
    const stepRuns = workflow.workflow_steps.map((step: any, index: number) => {
      let status = 'pending';
      if (step.type === 'http_request' || step.type === 'llm_call' || step.type === 'db_write' || step.type === 'conditional_branch' || step.type === 'notify') {
        status = 'completed'; 
      }
      if (step.type === 'approval_gate') {
        status = 'paused_awaiting_approval';
      }
      return { step_id: step.id, status: status };
    });

    // 4. Insert the live run into the database
    await fetch(graphqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret },
      body: JSON.stringify({
        query: `
          mutation StartEngine($workflowId: uuid!, $stepRuns: [step_runs_insert_input!]!) {
            insert_workflow_runs_one(object: {
              workflow_id: $workflowId,
              status: "running",
              step_runs: { data: $stepRuns }
            }) { id }
          }
        `,
        variables: { workflowId: workflow_id, stepRuns: stepRuns }
      })
    });

    return res.status(200).json({
      success: true,
      message: "Engine executed! Quota checked and API delay simulated."
    });

  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}