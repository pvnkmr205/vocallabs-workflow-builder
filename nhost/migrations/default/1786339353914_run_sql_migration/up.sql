CREATE OR REPLACE VIEW org_usage_aggregation AS
SELECT 
    w.org_id,
    COUNT(wr.id) AS total_runs,
    COUNT(CASE WHEN wr.status = 'completed' THEN 1 END) AS successful_runs
FROM workflows w
LEFT JOIN workflow_runs wr ON w.id = wr.workflow_id
GROUP BY w.org_id;
