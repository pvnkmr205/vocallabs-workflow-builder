import { Request, Response } from 'express';

export default async function handler(req: Request, res: Response) {
  try {
    const { step_run_id } = req.body.input;
    // Nhost automatically passes the user's ID in this header
    const userId = req.body.session_variables?.['x-hasura-user-id'];
    
    const graphqlUrl = process.env.NHOST_GRAPHQL_URL as string;
    const adminSecret = process.env.NHOST_ADMIN_SECRET as string;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized: Missing User ID" });
    }

    // 1. Layer 2 Security Check: Is the user an owner or editor?
    const authCheckRes = await fetch(graphqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret },
      body: JSON.stringify({
        query: `
          query CheckPermission($stepRunId: uuid!, $userId: uuid!) {
            step_runs_by_pk(id: $stepRunId) {
              workflow_run {
                workflow {
                  organization {
                    org_members(where: { user_id: { _eq: $userId }, role: { _in: ["owner", "editor"] } }) {
                      id
                    }
                  }
                }
              }
            }
          }
        `,
        variables: { stepRunId: step_run_id, userId: userId }
      })
    });
    
    const authData = await authCheckRes.json();
    const members = authData.data?.step_runs_by_pk?.workflow_run?.workflow?.organization?.org_members;
    
    // If the user isn't found in that org with the correct role, reject the action!
    if (!members || members.length === 0) {
      return res.status(403).json({ 
        success: false, 
        message: "Forbidden: You must be an owner or editor in this organization to approve this step." 
      });
    }

    // 2. Mark this approval step as completed
    await fetch(graphqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret },
      body: JSON.stringify({
        query: `
          mutation ApproveStep($stepRunId: uuid!) {
            update_step_runs_by_pk(
              pk_columns: { id: $stepRunId },
              _set: { status: "completed" }
            ) { id, workflow_run_id }
          }
        `,
        variables: { stepRunId: step_run_id }
      })
    });

    // 3. Find the workflow run ID
    const srRes = await fetch(graphqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret },
      body: JSON.stringify({
        query: `
          query GetWorkflowRun($stepRunId: uuid!) {
            step_runs_by_pk(id: $stepRunId) { workflow_run_id }
          }
        `,
        variables: { stepRunId: step_run_id }
      })
    });
    const srData = await srRes.json();
    const workflowRunId = srData.data?.step_runs_by_pk?.workflow_run_id;

    if (workflowRunId) {
      // 4. Complete any remaining pending steps
      await fetch(graphqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret },
        body: JSON.stringify({
          query: `
            mutation CompleteRest($runId: uuid!) {
              update_step_runs(
                where: { workflow_run_id: { _eq: $runId }, status: { _eq: "pending" } },
                _set: { status: "completed" }
              ) { affected_rows }
            }
          `,
          variables: { runId: workflowRunId }
        })
      });

      // 5. Mark workflow run as completed
      await fetch(graphqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret },
        body: JSON.stringify({
          query: `
            mutation FinishRun($runId: uuid!) {
              update_workflow_runs_by_pk(
                pk_columns: { id: $runId },
                _set: { status: "completed" }
              ) { id }
            }
          `,
          variables: { runId: workflowRunId }
        })
      });

      // 6. Fetch workflow ID to increment organization quota
      const wfRes = await fetch(graphqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret },
        body: JSON.stringify({
          query: `
            query GetWfId($runId: uuid!) {
              workflow_runs_by_pk(id: $runId) { workflow_id }
            }
          `,
          variables: { runId: workflowRunId }
        })
      });
      const wfData = await wfRes.json();
      const workflowId = wfData.data?.workflow_runs_by_pk?.workflow_id;

      if (workflowId) {
        const orgRes = await fetch(graphqlUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret },
          body: JSON.stringify({
            query: `
              query GetOrg($wfId: uuid!) {
                workflows_by_pk(id: $wfId) { org_id }
              }
            `,
            variables: { wfId: workflowId }
          })
        });
        const orgData = await orgRes.json();
        const orgId = orgData.data?.workflows_by_pk?.org_id;

        if (orgId) {
          // 7. Increment quota used
          await fetch(graphqlUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret },
            body: JSON.stringify({
              query: `
                mutation IncQuota($orgId: uuid!) {
                  update_organizations_by_pk(
                    pk_columns: { id: $orgId },
                    _inc: { quota_used: 1 }
                  ) { id }
                }
              `,
              variables: { orgId: orgId }
            })
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: "Step approved successfully and workflow completed!"
    });

  } catch (error: any) {
    console.error("Approve step error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
}