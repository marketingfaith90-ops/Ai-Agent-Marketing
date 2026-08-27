export default async function handler(req, res) {
  const WEBHOOK = process.env.BITRIX24_WEBHOOK;
  const GROUP_ID = process.env.BITRIX24_MARKETING_GROUP_ID;

  if (!WEBHOOK) return res.status(200).json({ error: "BITRIX24_WEBHOOK not set" });

  const results = {};

  try {
    // Test 1 - basic connection
    const test1 = await fetch(`${WEBHOOK}app.info`, { signal: AbortSignal.timeout(8000) });
    results.test1_app_info = await test1.json();
  } catch(e) { results.test1_error = e.message; }

  try {
    // Test 2 - get tasks with GROUP_ID filter
    const test2 = await fetch(`${WEBHOOK}tasks.task.list?filter[GROUP_ID]=${GROUP_ID}`, { signal: AbortSignal.timeout(8000) });
    results.test2_tasks = await test2.json();
  } catch(e) { results.test2_error = e.message; }

  try {
    // Test 3 - get tasks with POST method
    const test3 = await fetch(`${WEBHOOK}tasks.task.list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filter: { GROUP_ID: GROUP_ID }, select: ["ID", "TITLE", "STATUS", "CREATED_DATE"] }),
      signal: AbortSignal.timeout(8000)
    });
    results.test3_post = await test3.json();
  } catch(e) { results.test3_error = e.message; }

  try {
    // Test 4 - get all tasks without filter
    const test4 = await fetch(`${WEBHOOK}tasks.task.list`, { signal: AbortSignal.timeout(8000) });
    const d4 = await test4.json();
    results.test4_all_tasks = {
      total: d4.result?.tasks?.length || 0,
      first_3: d4.result?.tasks?.slice(0,3).map(t => ({ id: t.ID, title: t.TITLE })) || [],
      error: d4.error || null
    };
  } catch(e) { results.test4_error = e.message; }

  return res.status(200).json({
    webhook_preview: WEBHOOK.substring(0, 60) + "...",
    group_id: GROUP_ID,
    results
  });
}
