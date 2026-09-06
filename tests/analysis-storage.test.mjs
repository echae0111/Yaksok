import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import * as storage from "../app/analysis-storage.ts";

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
const pdf = (text = "contract A", name = "contract.pdf") => new File([text], name, { type: "application/pdf", lastModified: 123 });
const analysis = { summary: "원래 분석", items: [{ original: "원문", core: "설명" }] };

test("identifies renamed identical PDFs but separates different contents", async () => {
  assert.equal(await storage.documentHash(pdf()), await storage.documentHash(pdf("contract A", "renamed.pdf")));
  assert.notEqual(await storage.documentHash(pdf()), await storage.documentHash(pdf("contract B")));
});

test("restores exact analysis, PDF and conversations after a fresh module load", async () => {
  const file = pdf();
  const hash = await storage.documentHash(file);
  await storage.saveDocument(hash, file, analysis);
  const messages = [{ role: "user", text: "질문" }, { role: "assistant", text: "답변", citations: [{ original: "원문" }] }];
  await storage.saveMessages(hash, messages);
  const reloaded = await import(`../app/analysis-storage.ts?reload=${Date.now()}`);
  const saved = await reloaded.restoreLastDocument();
  assert.deepEqual(saved.analysis, analysis);
  assert.deepEqual(saved.messages, messages);
  assert.equal(saved.fileName, "contract.pdf");
  assert.equal(await saved.file.text(), await file.text());
  assert.equal(saved.lastModified, 123);
});

test("first stored result wins across concurrent duplicate analyses", async () => {
  const file = pdf();
  const hash = await storage.documentHash(file);
  const [first, second] = await Promise.all([
    storage.saveDocument(hash, file, analysis),
    storage.saveDocument(hash, file, { summary: "다른 생성 결과" }),
  ]);
  assert.deepEqual(first.analysis, second.analysis);
  assert.deepEqual((await storage.getSavedDocument(hash)).analysis, analysis);
});

test("other file clears restoration without deleting saved analyses or mixing conversations", async () => {
  const file = pdf();
  const hash = await storage.documentHash(file);
  await storage.saveDocument(hash, file, analysis);
  await storage.clearLastDocument();
  assert.equal(await storage.restoreLastDocument(), null);
  assert.deepEqual((await storage.getSavedDocument(hash)).analysis, analysis);
  const other = pdf("contract B");
  const otherHash = await storage.documentHash(other);
  await storage.saveDocument(otherHash, other, { summary: "B" });
  await storage.saveMessages(hash, [{ text: "A의 답변" }]);
  assert.equal((await storage.restoreLastDocument()).hash, otherHash);
  assert.deepEqual((await storage.restoreLastDocument()).messages, []);
  const reused = await storage.saveDocument(hash, file, { summary: "재생성하면 안 됨" });
  assert.deepEqual(reused.analysis, analysis);
  assert.deepEqual(reused.messages, [{ text: "A의 답변" }]);
});

test("aborted writes reject and do not leave a partial document or last pointer", async () => {
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    const request = original.call(this, value, key);
    if (key === "last-document") this.transaction.abort();
    return request;
  };
  try { await assert.rejects(storage.saveDocument("hash", pdf(), analysis)); }
  finally { IDBObjectStore.prototype.put = original; }
  assert.equal(await storage.getSavedDocument("hash"), null);
  assert.equal(await storage.restoreLastDocument(), null);
});

test("old clause caches remain readable and unavailable storage fails gracefully", async () => {
  await storage.setCachedAnalysis("legacy:clause", { explanation: "저장된 설명" });
  assert.deepEqual(await storage.getCachedAnalysis("legacy:clause"), { explanation: "저장된 설명" });
  globalThis.indexedDB = { open() { throw new Error("Storage disabled"); } };
  assert.equal(await storage.restoreLastDocument(), null);
  assert.equal(await storage.setCachedAnalysis("key", analysis), false);
  await assert.rejects(storage.saveDocument("hash", pdf(), analysis));
});
