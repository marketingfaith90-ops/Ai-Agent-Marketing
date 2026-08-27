export default async function handler(req, res) {
  const WEBHOOK = process.env.BITRIX24_WEBHOOK;
  const GROUP_ID = process.env.BITRIX24_MARKETING_GROUP_ID;

  if (!WEBHOOK) return res.status(200).json({ error: "BITRIX24_WEBHOOK not set" });
  if (!GROUP_ID) return res.status(200).json({ error: "BITRIX24_MARKETING_GROUP_ID not set" });

  try {
    // Test 1 - check env vars
    const envCheck = {
      webhook_preview: WEBHOOK.substring(0, 50) + "...",
      group_id: GROUP_ID
    };

    // Test 2 - call Bitrix24 API
    const url = `${WEBHOOK}tasks.task.list?filter[GROUP_ID]=${GROUP_ID}&select[]=ID&select[]=TITLE&select[]=STATUS&select[]=CREATED_DATE`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();

    if (d.error) {
      return res.status(200).json({
        ...envCheck,
        bitrix_error: d.error,
        bitrix_error_description: d.error_description
      });
    }

    const tasks = d.result?.tasks || [];
    const kadirTasks = tasks.filter(t => t.TITLE?.toLowerCase().includes("kadir"));
    const augustTasks = tasks.filter(t => {
      const date = new Date(t.CREATED_DATE);
      return date.getMonth() === 7 && date.getFullYear() === 2026;
    });

    return res.status(200).json({
      ...envCheck,
      connection: "SUCCESS",
      total_tasks: tasks.length,
      august_tasks: augustTasks.length,
      kadir_tasks: kadirTasks.map(t => ({
        title: t.TITLE,
        status: t.STATUS,
        created: t.CREATED_DATE
      })),
      all_titles: tasks.slice(0, 10).map(t => t.TITLE)
    });

  } catch(e) {
    return res.status(200).json({ error: e.message });
  }
}
