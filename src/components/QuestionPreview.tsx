"use client";

interface AnswerOption {
  id: string;
  text: string;
  sort: number;
}

interface PreviewQuestion {
  id: string;
  sort: number;
  deskripsi: string;
  options: AnswerOption[];
  aiAnswer?: {
    questionId: string;
    selectedAnswerId: string;
    reasoning: string;
  };
}

interface QuestionPreviewProps {
  questions: PreviewQuestion[];
  kode_course?: string;
  kode_section?: string;
  judul?: string;
  duration?: number;
  time_left?: number;
}

export default function QuestionPreview({
  questions,
  kode_course,
  kode_section,
  judul,
  duration,
  time_left,
}: QuestionPreviewProps) {
  if (questions.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Quiz info header */}
      <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
        <div className="flex flex-wrap gap-4 text-sm">
          {judul && (
            <div>
              <span className="text-gray-500">Quiz:</span>{" "}
              <span className="text-white font-medium">{judul}</span>
            </div>
          )}
          {kode_section && (
            <div>
              <span className="text-gray-500">Section:</span>{" "}
              <span className="text-white font-medium">{kode_section.replace(/_/g, " ")}</span>
            </div>
          )}
          {duration !== undefined && (
            <div>
              <span className="text-gray-500">Duration:</span>{" "}
              <span className="text-white font-medium">{duration} min</span>
            </div>
          )}
          {time_left !== undefined && (
            <div>
              <span className="text-gray-500">Time left:</span>{" "}
              <span className="text-yellow-400 font-medium">{time_left}s</span>
            </div>
          )}
        </div>
        {kode_course && (
          <div className="mt-1 text-xs text-gray-600">{kode_course}</div>
        )}
      </div>

      {/* Questions */}
      <div className="space-y-3">
        {questions.map((q) => (
          <div
            key={q.id}
            className="bg-gray-800/30 rounded-xl border border-gray-700 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-gray-700/50 flex items-start gap-3">
              <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5">
                Q{q.sort}
              </span>
              <p className="text-gray-200 text-sm leading-relaxed">{q.deskripsi}</p>
            </div>
            <div className="p-3 space-y-1.5">
              {q.options.map((opt) => {
                const isSelected = q.aiAnswer?.selectedAnswerId === opt.id;
                return (
                  <div
                    key={opt.id}
                    className={`flex items-start gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isSelected
                        ? "bg-green-500/20 border border-green-500/40 text-green-300"
                        : "text-gray-400 border border-transparent"
                    }`}
                  >
                    <span
                      className={`shrink-0 w-5 h-5 rounded-full border flex items-center justify-center text-xs font-bold mt-0.5 ${
                        isSelected
                          ? "bg-green-500 border-green-500 text-white"
                          : "border-gray-600"
                      }`}
                    >
                      {isSelected ? "✓" : opt.sort}
                    </span>
                    <span className="leading-relaxed">{opt.text}</span>
                  </div>
                );
              })}
            </div>
            {q.aiAnswer?.reasoning && (
              <div className="px-4 pb-3">
                <p className="text-xs text-gray-500 italic">
                  AI reasoning: {q.aiAnswer.reasoning}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
