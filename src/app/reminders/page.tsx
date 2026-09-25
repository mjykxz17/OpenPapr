import { redirect } from "next/navigation";

// Reminders became Tasks; old links and bookmarks land there.
export default function RemindersPage() {
  redirect("/tasks");
}
