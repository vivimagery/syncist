import { Task } from "../types/database";
import { DateYMDString } from "../types/dates";

const urlBase = "https://api.todoist.com/api/v1";
const headers = {
  // @ts-ignore
  Authorization: `Bearer ${TODOIST_API_KEY}`,
  "Content-Type": "application/json",
};

async function assertOk(response: Response, context: string) {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${context} failed (${response.status}): ${text}`);
  }
}

export async function returnTaskInfo(request: Request) {
  const body: any = await request.json();
  const info: TaskInfo = {
    eventName: body.event_name,
    taskId: body.event_data.id,
    content: body.event_data.content,
    projectId: body.event_data.project_id,
    completed: body.event_data.checked === 1,
    labels: body.event_data.labels,
    priority: body.event_data.priority,
    dueDate: body.event_data.due,
    assignee: body.event_data.responsible_uid,
  };
  return info;
}

export async function addTask({
  content,
  due_date,
  priority,
  description,
}: {
  content: string;
  due_date?: Due["date"];
  priority?: TaskInfo["priority"];
  description?: string;
}) {
  const task = {
    content,
    project_id: TODOIST_PROJECT,
    due_date: due_date || null,
    priority: mapPriority(priority),
    ...(description && { description }),
  };

  const response = await fetch(`${urlBase}/tasks`, {
    headers,
    method: "POST",
    body: JSON.stringify(task),
  });

  await assertOk(response, "Todoist addTask");
  return response.json();
}

export async function completeTask(taskId: Task["todoist_task_id"]) {
  const response = await fetch(`${urlBase}/tasks/${taskId}/close`, {
    headers,
    method: "POST",
  });

  await assertOk(response, "Todoist completeTask");
}

export interface UpdateTaskOptions {
  content?: TaskInfo["content"];
  due_date?: Due["date"];
  priority?: TaskInfo["priority"];
  description?: string;
}

export async function updateTask(
  taskId: Task["todoist_task_id"],
  taskInfo: UpdateTaskOptions
) {
  const mappedTaskInfo = {
    ...taskInfo,
    // Only map the priority if it exists
    ...(taskInfo.priority !== undefined && {
      priority: mapPriority(taskInfo.priority)
    })
  };
  const response = await fetch(`${urlBase}/tasks/${taskId}`, {
    headers,
    method: "POST",
    body: JSON.stringify(mappedTaskInfo),
  });

  await assertOk(response, "Todoist updateTask");
  return response.json();
}

/**
 * Deletes a task from Todoist by its task ID.
 * @param taskId - The Todoist task ID to delete
 * @returns Promise resolving to true if successful, false otherwise
 */
export async function deleteTask(taskId: Task["todoist_task_id"]): Promise<boolean> {
  const response = await fetch(`${urlBase}/tasks/${taskId}`, {
    headers,
    method: "DELETE",
  });

  return response.ok;
}

export interface TaskInfo {
  eventName:
    | "item:added"
    | "item:completed"
    | "item:uncompleted"
    | "item:updated"
    | "item:deleted";
  taskId: string;
  content?: string;
  projectId?: string | null;
  completed: boolean;
  labels?: string[];
  priority?: 1 | 2 | 3 | 4;
  dueDate?: Due | null;
  assignee?: string | null;
}

interface Due {
  date: DateYMDString | null;
  datetime?: string;
  recurring: boolean;
  string: string;
  timezone?: string;
}

/**
 * Linear -> Todoist:
 * - 0 → 1 (lowest priority)
 * - 4 → 2
 * - 3 → 3
 * - 2 → 4
 * - 1 → 4 (highest priority)
 */
export function mapPriority(originalPriority: number | null | undefined): number | null {
  if (originalPriority === null || originalPriority === undefined) return null;
  
  const priorityMap: Record<number, number> = {
    0: 2,
    4: 2,
    3: 3,
    2: 4,
    1: 4
  };
  
  return priorityMap[originalPriority] || originalPriority;
}
