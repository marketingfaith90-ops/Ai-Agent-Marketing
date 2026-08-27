export default async function handler(req, res) {
  const WEBHOOK = process.env.BITRIX24_WEBHOOK;
  const GROUP_ID = process.env.BITRIX24_MARKETING_GROUP_ID;

  if (!WEBHOOK) return res.status(200).json({ error: "BITRIX24_WEBHOOK not set in Vercel" });
  if (!GROUP_ID) return res.status(200).json({ error: "BITRIX24_MARKETING_GROUP_ID not set in Vercel" });

  try {
    // Get tasks from marketing group
    const url = `${WEBHOOK}tasks.task.list?filter[GROUP_ID]=${GROUP_ID}&select[]=ID&select[]=TITLE&select[]=STATUS&select[]=CREATED_DATE&select[]=DEADLINE`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();

    if (d.error) return res.status(200).json({ 
      error: d.error, 
      error_description: d.error_description,
      webhook: WEBHOOK.substring(0, 40) + "...",
      group_id: GROUP_ID
    });

    const tasks = d.result?.tasks || [];
    
    // Find Kadir tasks specifically
    const kadirTasks = tasks.filter(t => 
      t.TITLE?.toLowerCase().includes("kadir")
    );

    return res.status(200).json({
      connection: "SUCCESS",
      group_id: GROUP_ID,
      total_tasks_in_group: tasks.length,
      kadir_tasks_found: kadirTasks.length,
      kadir_tasks: kadirTasks.map(t => ({
        title: t.TITLE,
        status: t.STATUS,
        created: t.CREATED_DATE
      })),
      all_task_titles: tasks.slice(0, 10).map(t => t.TITLE)
    });

  } catch(e) {
    return res.status(200).json({ error: e.message });
  }
}
