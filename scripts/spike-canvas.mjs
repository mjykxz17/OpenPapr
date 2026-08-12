// scripts/spike-canvas.mjs — run: CANVAS_TOKEN=... node scripts/spike-canvas.mjs
const BASE = process.env.CANVAS_BASE_URL ?? "https://canvas.nus.edu.sg";
const TOKEN = process.env.CANVAS_TOKEN;
if (!TOKEN) { console.error("Set CANVAS_TOKEN"); process.exit(1); }
const get = async (path) => {
  const res = await fetch(`${BASE}/api/v1${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`);
  return res.json();
};
const courses = await get("/courses?enrollment_state=active&per_page=100&include[]=term&include[]=syllabus_body");
console.log(`courses: ${courses.length}`);
for (const c of courses) {
  console.log(`- [${c.id}] ${c.course_code} | term=${c.term?.name} | syllabus=${c.syllabus_body ? c.syllabus_body.length + " chars" : "EMPTY"}`);
  const groups = await get(`/courses/${c.id}/assignment_groups?include[]=assignments&include[]=submission&per_page=100`);
  for (const g of groups) console.log(`    group "${g.name}" weight=${g.group_weight} assignments=${g.assignments?.length ?? 0}`);
  const ann = await get(`/courses/${c.id}/discussion_topics?only_announcements=true&per_page=5`);
  console.log(`    announcements: ${ann.length}`);
}
