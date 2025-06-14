import gql from "graphql-tag";
import { Team } from "../types/database";
import { DateYMDString } from "../types/dates";

const url = "https://api.linear.app/graphql";
const headers = {
  // @ts-ignore
  Authorization: LINEAR_API_KEY,
  "Content-Type": "application/json",
};
const method = "POST";

const client = async (body: string) => {
  // @ts-ignore
  const response = await fetch(url, {
    body,
    headers,
    method,
  });

  return response.json();
};

export async function getMyIssues() {
  const body = '{ "query": "{ issues { nodes { id title } } }" }';

  const response = client(body);
  return response;
}

export async function markIssueComplete(
  issueId: IssueInfo["id"],
  finalStateId: Team["linear_final_state_id"]
) {
  const body = JSON.stringify({
    query: `
      mutation IssueUpdate($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) {
          success
        }
      }
    `,
    variables: {
      id: issueId,
      stateId: finalStateId,
    },
  });

  const response: any = await client(body);
  const success = response?.data?.issueUpdate?.success;
  return success;
}

export async function addCommentToIssue(
  issueId: IssueInfo["id"],
  commentBody: string
) {
  const body = JSON.stringify({
    query: `
      mutation IssueUpdate($issueId: String!, $body: String!) {
        commentCreate(input: {body: $body, issueId: $issueId}) {
          success
        }
      }
    `,
    variables: {
      issueId,
      body: commentBody,
    },
  });

  const response: any = await client(body);
  const success = response?.data?.issueUpdate?.success;
  return success;
}

export async function returnIssueInfo(request: Request) {
  const body: any = await request.json();
  const info: IssueInfo = {
    action: body.action,
    id: body.data.id,
    title: body.data.title,
    priorityLabel: body.data.priorityLabel,
    priority: body.data.priority,
    assigneeId: body.data.assigneeId,
    dueDate: body.data.dueDate,
    state: {
      name: body.data.state.name,
      type: body.data.state.type,
    },
  };
  return info;
}

export interface IssueInfo {
  action: string;
  id: string;
  title: string;
  priorityLabel?: string;
  priority?: number;
  assigneeId?: string;
  dueDate: DateYMDString | null;
  state: IssueInfoState;
}

interface IssueInfoState {
  name: string;
  type: string;
}
