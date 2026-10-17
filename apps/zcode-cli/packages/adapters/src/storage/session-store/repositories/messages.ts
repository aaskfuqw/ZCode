import type { DatabaseSync } from "node:sqlite";
import type {
  MessageId,
  MessageInfo,
  MessagePart,
  MessageWithParts,
  PartId,
  SessionId,
} from "@zcode/contracts";
import { decodeMessageRow, decodePartRow, partCreatedAt } from "../codecs.js";
import { encodeJson } from "../json.js";
import type { MessageRow, PartRow } from "../rows.js";
import { touchSession } from "./sessions.js";

// Updates retain their sequence; moving a row to another scope appends it there.
export async function saveMessage(db: DatabaseSync, input: MessageInfo): Promise<void> {
  const { id, sessionID, ...data } = input;
  const timeCreated = input.time.created;
  const timeUpdated =
    input.role === "assistant" ? (input.time.completed ?? Date.now()) : timeCreated;

  db.prepare(
    `
      insert into message (id, session_id, time_created, time_updated, data, sequence)
      values (
        ?,
        ?,
        ?,
        ?,
        ?,
        (
          select coalesce(max(sequence), -1) + 1
          from message
          where session_id = ?
        )
      )
      on conflict(id) do update set
        session_id = excluded.session_id,
        time_updated = excluded.time_updated,
        data = excluded.data,
        sequence = case
          when message.session_id = excluded.session_id then message.sequence
          else excluded.sequence
        end
      `,
  ).run(id, sessionID, timeCreated, timeUpdated, encodeJson(data), sessionID);
  touchSession(db, sessionID, timeUpdated);
}

export async function removeMessage(
  db: DatabaseSync,
  input: { sessionID: SessionId; messageID: MessageId },
): Promise<void> {
  db.prepare("delete from message where id = ? and session_id = ?").run(
    input.messageID,
    input.sessionID,
  );
}

export async function savePart(db: DatabaseSync, input: MessagePart): Promise<void> {
  const { id, sessionID, messageID, ...data } = input;
  let storedData: Record<string, unknown> = data;
  if (input.type === "timeline" && input.timelineType === "model_change") {
    const { fromModel, toModel, ...part } = data as typeof input;
    storedData = {
      ...part,
      fromModelSelection: fromModel,
      toModelSelection: toModel,
    };
  } else if (input.type === "subtask") {
    const { model, ...part } = data as typeof input;
    storedData = { ...part, modelSelection: model };
  }
  const now = Date.now();

  db.prepare(
    `
      insert into part (id, message_id, session_id, time_created, time_updated, data, sequence)
      values (
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        (
          select coalesce(max(sequence), -1) + 1
          from part
          where message_id = ?
        )
      )
      on conflict(id) do update set
        message_id = excluded.message_id,
        session_id = excluded.session_id,
        time_updated = excluded.time_updated,
        data = excluded.data,
        sequence = case
          when part.message_id = excluded.message_id and part.session_id = excluded.session_id
            then part.sequence
          else excluded.sequence
        end
      `,
  ).run(
    id,
    messageID,
    sessionID,
    partCreatedAt(input, now),
    now,
    encodeJson(storedData),
    messageID,
  );
  touchSession(db, sessionID, now);
}

export async function removePart(
  db: DatabaseSync,
  input: {
    sessionID: SessionId;
    messageID: MessageId;
    partID: PartId;
  },
): Promise<void> {
  db.prepare("delete from part where id = ? and message_id = ? and session_id = ?").run(
    input.partID,
    input.messageID,
    input.sessionID,
  );
}

export async function messages(
  db: DatabaseSync,
  input: { sessionID: SessionId },
): Promise<MessageWithParts[]> {
  const messageRows = db
    .prepare(
      `
      select * from message
      where session_id = ?
      order by sequence is null, sequence, time_created, rowid
      `,
    )
    .all(input.sessionID) as unknown as MessageRow[];

  const partRows = db
    .prepare(
      `
      select * from part
      where session_id = ?
      order by message_id, sequence is null, sequence, time_created, id
      `,
    )
    .all(input.sessionID) as unknown as PartRow[];
  const partsByMessage = new Map<string, MessagePart[]>();

  for (const row of partRows) {
    const part = decodePartRow(row);
    const list = partsByMessage.get(row.message_id) ?? [];
    list.push(part);
    partsByMessage.set(row.message_id, list);
  }

  return messageRows.map((row) => ({
    info: decodeMessageRow(row),
    parts: partsByMessage.get(row.id) ?? [],
  }));
}

export async function messageWithParts(
  db: DatabaseSync,
  input: { sessionID: SessionId; messageID: MessageId },
): Promise<MessageWithParts | null> {
  const messageRow = db
    .prepare("select * from message where id = ? and session_id = ?")
    .get(input.messageID, input.sessionID) as unknown as MessageRow | undefined;
  if (!messageRow) return null;

  const partRows = db
    .prepare(
      `
      select * from part
      where message_id = ? and session_id = ?
      order by sequence is null, sequence, time_created, id
      `,
    )
    .all(input.messageID, input.sessionID) as unknown as PartRow[];
  return {
    info: decodeMessageRow(messageRow),
    parts: partRows.map(decodePartRow),
  };
}
