import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import { sendProjectChatMessage } from "../../services/meeting";
import sendImg from "../../assets/meeting/send.png";
import chatbotImg from "../../assets/project/chatbot_image.png"

type ChatMsg = { role: "user" | "bot"; content: string };

const MIN_WIDTH = 280;
const MIN_HEIGHT = 360;
const MAX_WIDTH = 600;
const MAX_HEIGHT = 800;
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 460;

export default function FloatingChatbot() {
  const { projectId } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const chatRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startSize = useRef({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

  const [chatProjectId, setChatProjectId] = useState(projectId);

  // 프로젝트 바뀌면 대화 초기화
  if (chatProjectId !== projectId) {
    setChatProjectId(projectId);
    setChatMessages([]);
    setChatInput("");
  }

  // 메시지 추가될 때 스크롤 아래로
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  // 드래그 중 크기 변경
  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    const dx = startPos.current.x - e.clientX; // 왼쪽으로 드래그 → 넓어짐
    const dy = startPos.current.y - e.clientY; // 위로 드래그 → 높아짐
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startSize.current.width + dx));
    const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startSize.current.height + dy));
    setSize({ width: newWidth, height: newHeight });
  }, []);

  // 드래그 종료
// 수정 — useRef로 최신 함수 참조 유지
  const onMouseUpRef = useRef<() => void>(() => {});

  const onMouseUp = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUpRef.current);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, [onMouseMove]);

  useEffect(() => {
    onMouseUpRef.current = onMouseUp;
  }, [onMouseUp]);

  // 드래그 시작 (좌상단 모서리)
  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    startPos.current = { x: e.clientX, y: e.clientY };
    startSize.current = { width: size.width, height: size.height };
    document.body.style.userSelect = "none"; // 드래그 중 텍스트 선택 방지
    document.body.style.cursor = "nw-resize";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading || !projectId) return;

    const query = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: query }]);
    setChatLoading(true);

    try {
      const res = await sendProjectChatMessage(projectId, query);
      setChatMessages((prev) => [...prev, { role: "bot", content: res.answer }]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "bot", content: "답변을 가져오는데 실패했습니다." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <>
      {/* 채팅창 */}
      {isOpen && (
        <div
          className="fixed bottom-27 right-6 bg-white rounded-2xl shadow-2xl border border-gray-100 flex flex-col z-50"
          style={{ width: size.width, height: size.height }}
        >
          {/* 크기 조절 핸들 (좌상단 모서리) */}
          <div
            onMouseDown={onResizeMouseDown}
            className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize z-10"
            style={{ borderRadius: "12px 0 0 0" }}
            title="드래그하여 크기 조절"
          />

          {/* 헤더 */}
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
            <span className="text-sm text-[#141414]">프로젝트 챗봇</span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-gray-600 transition text-lg leading-none"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>

          {/* 메시지 목록 */}
          <div ref={chatRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 flex flex-col gap-3">
            {!projectId ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <p className="text-xs text-gray-400">프로젝트를 선택하면 챗봇을 사용할 수 있습니다.</p>
              </div>
            ) : chatMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <p className="text-xs text-gray-400">
                  회의 준비 자료나 안건에 대해 자유롭게 질문해 보세요!
                </p>
              </div>
            ) : (
              chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`text-xs px-3 py-2 rounded-2xl max-w-[85%] border break-all ${
                      msg.role === "user"
                        ? "bg-[#F3F0FF] border-[#6A1FEB] text-[#141414] rounded-tr-sm"
                        : "bg-[#FAF9F7] border-[#FAF9F7] text-[#141414] rounded-tl-sm"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))
            )}

            {chatLoading && (
              <div className="items-start flex flex-col">
                <div className="bg-gray-100 text-gray-400 text-xs px-3 py-2 rounded-2xl rounded-tl-sm">
                  답변 생성 중...
                </div>
              </div>
            )}
          </div>

          {/* 입력창 */}
          <div className="p-4 border-t border-gray-100 flex-shrink-0">
            <div className="relative flex items-center">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
                disabled={!projectId || chatLoading}
                placeholder={projectId ? "챗봇한테 질문해보세요" : "프로젝트를 먼저 선택해주세요"}
                className="w-full text-xs pl-4 pr-10 py-3 border border-gray-200 rounded-xl outline-none focus:border-[#6A1FEB] disabled:bg-gray-50 disabled:text-gray-300 transition"
              />
              <button
                onClick={sendChat}
                disabled={!projectId || chatLoading}
                className="absolute right-2.5 w-7 h-7 flex items-center justify-center hover:opacity-70 active:scale-95 disabled:opacity-30 transition"
                aria-label="전송"
              >
                <img src={sendImg} alt="전송" className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 플로팅 버튼 */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="fixed bottom-6 right-6 w-16 h-16 bg-[#6A1FEB] rounded-full shadow-lg flex items-center justify-center hover:bg-[#4f32a0] active:scale-95 transition z-50"
        aria-label="챗봇 열기"
      >
        {isOpen ? (
          <span className="text-white text-lg leading-none">✕</span>
        ) : (
          <img src={chatbotImg} alt="챗봇" className="w-16" />
        )}
      </button>
    </>
  );
}
