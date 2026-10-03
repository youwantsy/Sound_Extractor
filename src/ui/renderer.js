"use strict";
const $ = (id) => document.getElementById(id);
const api = window.sonora;
let state = {
    jobs: [],
    running: false,
    settings: { bitrate: 192, naming: "title", conflict: "number" },
  },
  toolsReady = false;
const busy = new Set(["validating", "acquiring", "converting", "finalizing"]);
const labels = {
  queued: "대기",
  validating: "파일 확인",
  acquiring: "오디오 가져오는 중",
  converting: "MP3 변환 중",
  finalizing: "저장 중",
  done: "완료",
  failed: "오류",
  canceled: "취소됨",
  skipped: "건너뜀",
};
function escapeText(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function say(s) {
  $("message").textContent = s;
}
async function invoke(promise, success) {
  try {
    const result = await promise;
    if (!result.ok) {
      say(result.error);
      return false;
    }
    if (success) say(success);
    return result.value ?? true;
  } catch {
    say("앱과 연결할 수 없습니다. 다시 실행해 주세요.");
    return false;
  }
}
function row(j) {
  const active = busy.has(j.state),
    waiting = j.state === "queued";
  const name = j.outputPath ? j.outputPath.split(/[\\/]/).pop() : j.name;
  const queued = state.jobs.filter((x) => x.state === "queued");
  return `<div class="job" data-job="${j.id}"><span class="fileicon" aria-hidden="true">♫</span><div><strong>${escapeText(name)}</strong><div class="meta">${j.kind === "local" ? "로컬" : "YouTube"}${j.size ? " · " + (j.size / 1048576).toFixed(1) + " MB" : ""}${j.duration ? " · " + Math.round(j.duration) + "초" : ""}${j.options ? " · " + j.options.bitrate + " kbps" : ""}</div>${active ? `<progress max="100" value="${j.progress}" aria-label="${escapeText(j.name)} 진행률"></progress>` : ""}${j.error ? `<div class="meta status error">${escapeText(j.error)}</div>` : ""}</div><div class="actions"><span class="status ${j.state === "failed" ? "error" : j.state}">${j.cancelRequested ? "취소 중…" : labels[j.state]}${active ? " " + j.progress + "%" : ""}</span>${waiting ? `<button data-action="up" aria-label="${escapeText(j.name)} 위로" ${queued[0] === j ? "disabled" : ""}>↑</button><button data-action="down" aria-label="${escapeText(j.name)} 아래로" ${queued.at(-1) === j ? "disabled" : ""}>↓</button>` : ""}${active || waiting ? `<button data-action="cancel" ${j.cancelRequested ? "disabled" : ""}>취소</button>` : ""}${["failed", "canceled", "skipped"].includes(j.state) ? '<button data-action="retry">재시도</button>' : ""}${j.state === "done" ? '<button data-action="reveal">폴더에서 보기</button>' : ""}${!active ? `<button data-action="remove" aria-label="${escapeText(j.name)} 제거">×</button>` : ""}</div></div>`;
}
function render(next) {
  if (next) state = next;
  const focused = document.activeElement;
  const focusJob = focused?.closest("[data-job]")?.dataset.job;
  const focusAction = focused?.dataset.action;
  $("queue").innerHTML =
    state.jobs
      .filter((j) => j.state !== "done")
      .map(row)
      .join("") ||
    '<div class="empty">링크나 로컬 파일을 추가해 보세요.<br><span class="small">원본은 그대로 두고, 소리만 가져옵니다.</span></div>';
  $("historylist").innerHTML =
    state.jobs
      .filter((j) => j.state === "done")
      .map(row)
      .join("") ||
    '<div class="empty">완료된 오디오가 이곳에 표시됩니다.</div>';
  $("folder").textContent = state.outputDir || "";
  for (const key of ["bitrate", "naming", "conflict"])
    if (document.activeElement !== $(key)) $(key).value = state.settings[key];
  const pending = state.jobs.filter((j) => j.state === "queued").length,
    active = state.jobs.some((j) => busy.has(j.state));
  $("count").textContent =
    state.jobs.filter((j) => j.state !== "done").length + "개";
  $("start").disabled = !toolsReady || state.running || active || pending === 0;
  $("cancelall").disabled = !active && !pending;
  $("summary").textContent =
    `대기 ${pending} · 완료 ${state.jobs.filter((j) => j.state === "done").length} · 오류 ${state.jobs.filter((j) => j.state === "failed").length}`;
  if (focusJob && focusAction)
    document
      .querySelector(`[data-job="${focusJob}"] [data-action="${focusAction}"]`)
      ?.focus({ preventScroll: true });
  if (state.cleanupWarning)
    say(
      "이전 기록 저장 또는 임시 파일 정리에 문제가 있었습니다. 저장 폴더 권한을 확인하세요.",
    );
}
async function action(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const id = button.closest("[data-job]").dataset.job;
  const a = button.dataset.action;
  if (a === "up" || a === "down")
    await invoke(api.reorder(id, a === "up" ? -1 : 1));
  else
    await invoke(
      api[a](id),
      a === "retry"
        ? "다시 대기열에 추가했습니다. 전체 시작을 눌러 실행하세요."
        : undefined,
    );
}
$("queue").addEventListener("click", action);
$("historylist").addEventListener("click", action);
$("urlform").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (
    await invoke(api.addURL($("url").value), "YouTube 작업을 추가했습니다.")
  ) {
    $("url").value = "";
    $("url").removeAttribute("aria-invalid");
  } else $("url").setAttribute("aria-invalid", "true");
});
$("pick").onclick = () => invoke(api.chooseFiles());
$("choosefolder").onclick = () => invoke(api.chooseOutput());
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());
$("drop").ondragover = () => $("drop").classList.add("drag");
$("drop").ondragleave = () => $("drop").classList.remove("drag");
$("drop").ondrop = (e) => {
  e.preventDefault();
  $("drop").classList.remove("drag");
  void invoke(api.dropFiles(Array.from(e.dataTransfer.files)));
};
function settings() {
  return {
    bitrate: Number($("bitrate").value),
    naming: $("naming").value,
    conflict: $("conflict").value,
  };
}
for (const key of ["bitrate", "naming", "conflict"])
  $(key).onchange = () => invoke(api.settings(settings()));
$("start").onclick = async () => {
  if (await invoke(api.settings(settings())))
    await invoke(api.start(), "작업을 시작했습니다.");
};
$("cancelall").onclick = () =>
  invoke(api.cancelAll(), "작업을 취소하고 부분 파일을 정리합니다.");
$("clearhistory").onclick = () =>
  invoke(api.clearHistory(), "완료 기록을 비웠습니다. MP3 파일은 유지됩니다.");
document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      const tab = b.dataset.tab;
      document.querySelectorAll("[data-tab]").forEach((x) => {
        x.classList.toggle("active", x === b);
        x.setAttribute("aria-current", x === b ? "page" : "false");
      });
      $("convert").hidden = tab !== "convert";
      $("history").hidden = tab !== "history";
      $("output").hidden = tab === "history";
      $("extra").hidden = tab !== "settings";
      $("runbar").hidden = tab !== "convert";
      $("heading").textContent = {
        convert: "영상에서 소리만, 간편하게.",
        history: "준비된 소리, 한곳에서.",
        settings: "나에게 맞는 출력 방식.",
      }[tab];
      $("intro").textContent = {
        convert: "링크를 붙여 넣거나 영상을 선택해 MP3 작업을 준비하세요.",
        history: "완성된 MP3를 확인하고, 다음 작업을 이어가세요.",
        settings: "파일 이름과 저장 방식을 미리 정해 두세요.",
      }[tab];
    }),
);
api.onState(render);
(async () => {
  const initial = await invoke(api.state());
  if (initial && initial !== true) render(initial);
  const tools = await invoke(api.tools());
  toolsReady = !!tools.ready;
  $("toolstatus").textContent = toolsReady
    ? "●  변환 준비 완료"
    : "●  도구 확인 필요";
  $("version").textContent = "Sonora " + (tools.version || "");
  if (!toolsReady)
    say(
      "필수 변환 도구가 없습니다. 앱을 다시 설치하거나 npm run tools를 실행하세요.",
    );
  render();
})();
