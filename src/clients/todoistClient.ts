import { Task } from "../types/database";
import { DateYMDString } from "../types/dates";

const urlBase = "https://api.todoist.com/rest/v2";
const headers = {
  // @ts-ignore
  Authorization: `Bearer ${TODOIST_API_KEY}`,
  "Content-Type": "application/json",
};

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

export async function addTask(taskName: string, dueDate?: Due["date"], priority?: TaskInfo["priority"]) {
  const task = {
    content: taskName,
    project_id: TODOIST_PROJECT,
    due_date: dueDate || null,
    priority: mapPriority(priority),
  };

  const response = await fetch(`${urlBase}/tasks`, {
    headers,
    method: "POST",
    body: JSON.stringify(task),
  });

  const body = await response.json();
  return body;
}

export async function completeTask(taskId: Task["todoist_task_id"]) {
  const response = await fetch(`${urlBase}/tasks/${taskId}/close`, {
    headers,
    method: "POST",
  });

  const body = await response.body;
  return body;
}

export async function updateTask(
  taskId: Task["todoist_task_id"],
  taskInfo: { content?: TaskInfo["content"]; due_date?: Due["date"]; priority?: TaskInfo["priority"]}
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

  const body = await response.body;
  return body;
}

export interface TaskInfo {
  eventName:
    | "item:added"
    | "item:completed"
    | "item:uncompleted"
    | "item:updated"
    | "item:deleted";
  taskId: number;
  content?: string;
  projectId?: number | null;
  completed: boolean;
  labels?: string[];
  priority?: 1 | 2 | 3 | 4;
  dueDate?: Due | null;
  assignee?: number | null;
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
    0: 1,
    4: 2,
    3: 3,
    2: 4,
    1: 4
  };
  
  return priorityMap[originalPriority] || originalPriority;
}
