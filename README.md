# AI Agent Workflow Builder

A multi-tenant, event-driven execution engine for chaining AI agent steps. Built for the Vocallabs Full-Stack Assignment, this platform allows users within isolated organizations to construct workflows, trigger runs (manually or via webhooks), and monitor live, step-by-step execution states.

**Live Deployment:** [vocallabs-workflow-builder-chi.vercel.app]([https://vocallabs-workflow-builder-chi.vercel.app/](https://vocallabs-workflow-builder-lfw0xdahc-pavans-projects-c3ed1f7b.vercel.app/))

---

## 🛠 Tech Stack
*   **Frontend:** Next.js (React 19), Apollo GraphQL Client, Tailwind CSS
*   **Backend:** Nhost (PostgreSQL, Hasura GraphQL Engine, Auth, Storage)
*   **Serverless:** Node.js (Hasura Actions & Event Triggers)

---

## 🏗 Architecture & Schema Reasoning
The database is structured to enforce strict multi-tenancy at the lowest level. 
* **`organizations` & `org_members`**: Serve as the root of the hierarchy. Every user is bound to an organization with a specific role (`owner`, `editor`, `viewer`). 
* **`workflows` & `workflow_steps`**: Workflows are tied directly to an `org_id`. Steps contain an `order_index` and a `JSONB` config payload to allow for dynamic node ordering and flexible step properties.
* **`workflow_runs` & `step_runs`**: Separating the templates (workflows) from their execution instances (runs) ensures we can track live status, pause executions, and maintain a historical ledger of every pipeline execution. 
* **Data Aggregation**: An `org_usage_aggregation` Postgres View tracks total and successful runs per organization to securely feed the dashboard without heavy frontend calculations.

---

## 🔒 Two-Layer Permission Model
Security is enforced using two distinct paradigms to ensure data isolation and execution control:

**Layer 1: Database Row-Level Security (RLS)**
Hasura's GraphQL engine is configured with strict RLS permissions based on the `X-Hasura-User-Id` session variable. A user can only `SELECT`, `INSERT`, or `UPDATE` workflows where their User ID exists in the `org_members` table for that workflow's parent organization. This guarantees airtight cross-org isolation (Org B cannot query or guess Org A's IDs).

**Layer 2: Serverless Function Gating (Action Handlers)**
Because triggering a run or clearing an approval gate involves mid-execution logic (like checking quotas and updating downstream steps), it cannot be handled by basic row writes. Layer 2 security is enforced inside the Hasura Action REST endpoints. When `approveStep` or `triggerWorkflowRun` is called, the Node.js function extracts the User ID from the secure `session_variables` payload, queries the database to verify the user holds an `owner` or `editor` role in that specific organization, and rejects the request with a `403 Forbidden` if they do not.

---

## ⏸ Approval Gate: Pause & Resume Logic
The execution engine is designed asynchronously using a database-as-state model. 
1. **Pause:** When the `triggerWorkflowRun` function maps out the pipeline, it evaluates the step types. If it encounters an `approval_gate`, it immediately inserts that step into the database with a status of `paused_awaiting_approval` and halts further execution. 
2. **Live Subscription:** The Next.js frontend uses an Apollo GraphQL subscription to watch the `step_runs` table. When the status hits `paused_awaiting_approval`, the UI reactively renders the "Approve & Continue" button without needing a page refresh.
3. **Resume:** Clicking the button fires the `approveStep` Hasura Action. After passing Layer 2 security checks, the function marks the paused step as `completed`, queries for any remaining `pending` steps in the run, updates them to `completed`, finishes the parent workflow run, and increments the organization's quota limit.

---

## 🔑 Test Credentials
To evaluate the multi-tenant isolation (Layer 1) and the role-based execution gating (Layer 2), two test accounts have been provisioned in the local database:

**Organization A (Owner - Full Access)**
*   **Email:** `owner@orga.com` 
*   **Password:** `password123`
*   **Role:** Can build workflows, trigger runs, and clear approval gates.

**Organization B (Attacker - Zero Access to Org A)**
*   **Email:** `hacker@orgb.com`
*   **Password:** `password123`
*   **Role:** Exists in a completely separate organization. Logging in with this account will result in a blank dashboard ("No workflows found") and blocked API requests to prove cross-org data isolation.

---

## 🚀 How to Run Locally

**1. Clone the repository:**
```bash
git clone [https://github.com/pvnkmr205/vocallabs-workflow-builder.git](https://github.com/pvnkmr205/vocallabs-workflow-builder.git)
cd vocallabs-workflow-builder

**2. Start the local Nhost backend:**

```bash
nhost up

**3. Install Frontend Dependencies:**
(Open a new terminal window to keep Nhost running)

```bash
cd frontend
npm install --legacy-peer-deps

**4. Run the Next.js development server:**

```bash
npm run dev

**5. Access the application:**
Open http://localhost:3000 in your browser.

Note: As per assignment instructions, the external LLM/HTTP calls inside the execution engine are currently stubbed using a disclosed 2-second artificial delay to simulate network latency.
