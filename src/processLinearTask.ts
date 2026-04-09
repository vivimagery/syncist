import {
  addCommentToIssue,
  IssueInfo,
  returnIssueInfo,
} from "./clients/linearClient";
import { addTask, completeTask, deleteTask, updateTask } from "./clients/todoistClient";
import { Task } from "./types/database";

const activeStates = ["unstarted", "started"];
const completeStates = ["completed"];
const backlogStates = ["backlog", "triage", "cancelled"];

/**
 * Helper function to create a new Todoist task and database entry for a Linear issue
 */
async function createTaskInTodoistAndDb(
  info: IssueInfo,
  db: any
) {
  const task: any = await addTask({
    content: info.title,
    due_date: info.dueDate,
    priority: info.priority,
    description: info.url,
  });
  const { data, error } = await db
    .from("task")
    .insert({ todoist_task_id: task.id, linear_task_id: info.id });

  if (error) {
    console.error("error adding task to database", error);
    return error;
  }

  await addCommentToIssue(
    info.id,
    "This issue is being tracked in Todoist."
  );

  return data[0];
}

export async function processLinearTask(issue: Request, db: any) {
  console.log("processLinearTask");
    const info: IssueInfo = await returnIssueInfo(issue);
    console.log(info);

    switch (info.action) {
      case "create":
        // Only add a task if issue is in progress or queue up. Ignore backlog and completion states.
        if (activeStates.includes(info.state.type)) {
          return await createTaskInTodoistAndDb(info, db);
        }
        break;
      case "update":
        // Check if task is in Todoist
        const { data: task }: { data: Task } = await db
          .from("task")
          .select()
          .eq("linear_task_id", info.id)
          .maybeSingle();

        // If task completed in Linear
        if (completeStates.includes(info.state.type)) {
          // If not completed, mark completed in Todoist
          if (task && !task.completed) {
            const completed = await completeTask(task.todoist_task_id)
              .then(async () => {
                const { data, error } = await db
                  .from("task")
                  .update({ completed: true, active: false })
                  .match({ linear_task_id: info.id });

                if (error) throw new Error(error);
                return {
                  task: data["0"],
                  success: true,
                  message: "Task completion status synced",
                };
              })
              .catch((err) => {
                console.log("error updating task in db", err);
              });

            console.log(completed);
            return completed;
          }
        } else if (backlogStates.includes(info.state.type)) {
          // If task moved back to backlog, delete from Todoist
          if (task && task.active) {
            const deleted = await deleteTask(task.todoist_task_id)
              .then(async () => {
                const { data, error } = await db
                  .from("task")
                  .update({ active: false })
                  .match({ linear_task_id: info.id });

                if (error) throw new Error(error);

                await addCommentToIssue(
                  info.id,
                  "Issue moved to backlog. Task deleted from Todoist."
                );

                return {
                  task: data["0"],
                  success: true,
                  message: "Task deleted from Todoist",
                };
              })
              .catch((err) => {
                console.log("error deleting task from Todoist", err);
              });

            console.log(deleted);
            return deleted;
          }
        } else if (activeStates.includes(info.state.type)) {
          // If task is now in active state
          if (!task) {
            // Task doesn't exist - create it (handles backlog→active transition)
            return await createTaskInTodoistAndDb(info, db);
          } else if (!task.active) {
            // Task exists but is inactive (was deleted from Todoist) - recreate it
            const newTask: any = await addTask({
              content: info.title,
              due_date: info.dueDate,
              priority: info.priority,
              description: info.url,
            });
            const { data, error } = await db
              .from("task")
              .update({ todoist_task_id: newTask.id, active: true })
              .match({ linear_task_id: info.id });

            if (error) {
              console.error("error updating task in database", error);
              return error;
            }

            await addCommentToIssue(
              info.id,
              "This issue is being tracked in Todoist."
            );

            return data[0];
          } else {
            // Task exists and is active - update it
            const updated = await updateTask(task.todoist_task_id, {
              content: info.title,
              due_date: info.dueDate || null,
              priority: info.priority,
              description: info.url,
            }).catch((err) => {
              console.log(`Unable to update task in Todoist: ${err}`);
              throw new Error(`Unable to update task in Todoist: ${err}`);
            });

            console.log(updated);
            return updated;
          }
        }
        break;
      default:
        return null;
  }
}
