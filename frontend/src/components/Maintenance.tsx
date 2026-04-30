import { useEffect, useMemo, useState } from 'react'

interface MaintenanceProps {
  title?: string
  message?: string
  expectedEndAt?: string | null
  durationHours?: number | null
}

type QuizItem = {
  id: string
  question: string
  choices: string[]
  correctIndex: number
  explanation?: string
}

const QUIZ_BANK: QuizItem[] = [
  {
    id: 'q1',
    question: 'Which planet is known as the Red Planet?',
    choices: ['Earth', 'Mars', 'Jupiter', 'Venus'],
    correctIndex: 1,
    explanation: 'Mars appears red because of iron oxide on its surface.',
  },
  {
    id: 'q2',
    question: 'What is the largest ocean on Earth?',
    choices: ['Atlantic Ocean', 'Indian Ocean', 'Pacific Ocean', 'Arctic Ocean'],
    correctIndex: 2,
    explanation: 'The Pacific Ocean is the largest and deepest ocean.',
  },
  {
    id: 'q3',
    question: 'Who wrote "Romeo and Juliet"?',
    choices: ['Charles Dickens', 'William Shakespeare', 'Jane Austen', 'Mark Twain'],
    correctIndex: 1,
  },
  {
    id: 'q4',
    question: 'What is the chemical symbol for gold?',
    choices: ['Ag', 'Au', 'Gd', 'Go'],
    correctIndex: 1,
  },
  {
    id: 'q5',
    question: 'Which country is home to the Great Pyramid of Giza?',
    choices: ['Greece', 'Mexico', 'Egypt', 'Jordan'],
    correctIndex: 2,
  },
  {
    id: 'q6',
    question: 'How many continents are there?',
    choices: ['5', '6', '7', '8'],
    correctIndex: 2,
  },
  {
    id: 'q7',
    question: 'What is the fastest land animal?',
    choices: ['Cheetah', 'Lion', 'Horse', 'Greyhound'],
    correctIndex: 0,
  },
  {
    id: 'q8',
    question: 'Which instrument has 88 keys?',
    choices: ['Guitar', 'Violin', 'Piano', 'Trumpet'],
    correctIndex: 2,
  },
  {
    id: 'q9',
    question: 'What is the capital of Japan?',
    choices: ['Seoul', 'Tokyo', 'Kyoto', 'Osaka'],
    correctIndex: 1,
  },
  {
    id: 'q10',
    question: 'Which gas do plants absorb from the atmosphere?',
    choices: ['Oxygen', 'Hydrogen', 'Nitrogen', 'Carbon dioxide'],
    correctIndex: 3,
  },
]

function randomQuestion(excludeIds: string[] = []): QuizItem {
  const available = QUIZ_BANK.filter((q) => !excludeIds.includes(q.id))
  const pool = available.length > 0 ? available : QUIZ_BANK
  return pool[Math.floor(Math.random() * pool.length)]
}

function getScoreMessage(correctCount: number, total: number): string {
  const ratio = total > 0 ? correctCount / total : 0
  if (ratio >= 0.9) return '🏆 Outstanding! You crushed it — quiz champion status unlocked.'
  if (ratio >= 0.7) return '🎉 Great job! Strong score. Your general knowledge is sharp.'
  if (ratio >= 0.5) return '👏 Nice work! Solid effort — keep it up and you will level up fast.'
  return '📚 Good attempt! Keep reading and researching — you will get even better.'
}

export default function Maintenance({
  title = 'Quick Tune-Up in Progress',
  message,
  expectedEndAt,
  durationHours,
}: MaintenanceProps) {
  const [askedIds, setAskedIds] = useState<string[]>([])
  const [quiz, setQuiz] = useState<QuizItem>(() => randomQuestion())
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)
  const [attemptCount, setAttemptCount] = useState(0)

  const selectedIsCorrect = submitted && selectedIndex === quiz.correctIndex
  const answerLabel = useMemo(() => quiz.choices[quiz.correctIndex], [quiz])
  const quizComplete = attemptCount >= QUIZ_BANK.length
  const scoreMessage = useMemo(
    () => getScoreMessage(correctCount, QUIZ_BANK.length),
    [correctCount]
  )

  const handleCheckAnswer = () => {
    if (selectedIndex === null || submitted) return
    setSubmitted(true)
    setAttemptCount((prev) => prev + 1)
    if (selectedIndex === quiz.correctIndex) {
      setCorrectCount((prev) => prev + 1)
    }
  }

  const handleNextQuestion = () => {
    if (!submitted) return
    const nextAsked = [...askedIds, quiz.id]
    setAskedIds(nextAsked.length >= QUIZ_BANK.length ? [] : nextAsked)
    setQuiz(randomQuestion(nextAsked))
    setSelectedIndex(null)
    setSubmitted(false)
  }

  const handleRestartQuiz = () => {
    setAskedIds([])
    setQuiz(randomQuestion())
    setSelectedIndex(null)
    setSubmitted(false)
    setCorrectCount(0)
    setAttemptCount(0)
  }

  const [nowMs, setNowMs] = useState<number>(Date.now())

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  const expectedEndMs = expectedEndAt ? new Date(expectedEndAt).getTime() : NaN
  const hasValidExpectedEnd = Number.isFinite(expectedEndMs)
  const remainingMs = hasValidExpectedEnd ? expectedEndMs - nowMs : null
  const countdownFinished = remainingMs !== null && remainingMs <= 0
  const totalDurationMs =
    typeof durationHours === 'number' && durationHours > 0 ? durationHours * 60 * 60 * 1000 : null
  const progressPercent =
    totalDurationMs && remainingMs !== null
      ? Math.max(0, Math.min(100, ((totalDurationMs - Math.max(0, remainingMs)) / totalDurationMs) * 100))
      : null

  const countdownText = useMemo(() => {
    if (remainingMs === null || remainingMs <= 0) return null
    const totalSeconds = Math.floor(remainingMs / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`
  }, [remainingMs])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-2xl w-full bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        <div className="text-center">
        <div className="text-4xl mb-4">🛠️</div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        <p className="mt-3 text-gray-600">
          {message || 'We are currently performing maintenance. Please check back shortly.'}
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Thank you for your patience.
        </p>
        {countdownText && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 text-sm font-semibold">
            <span>Estimated time remaining:</span>
            <span>{countdownText}</span>
          </div>
        )}
        {!countdownText && hasValidExpectedEnd && countdownFinished && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-100 text-blue-800 text-sm font-semibold">
            Final checks in progress...
          </div>
        )}
        {progressPercent !== null && (
          <div className="mt-4">
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 transition-all duration-700"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Maintenance progress: {Math.round(progressPercent)}%
            </p>
          </div>
        )}
        </div>

        <div className="mt-8 border border-indigo-100 rounded-lg p-5 bg-indigo-50/40">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-lg font-semibold text-indigo-900">While You Wait: Quick Quiz</h2>
            <span className="text-xs font-medium text-indigo-700 bg-indigo-100 px-2 py-1 rounded">
              Score: {correctCount} / {attemptCount}
            </span>
          </div>

          {!quizComplete && <p className="text-gray-800 font-medium">{quiz.question}</p>}

          {!quizComplete && (
            <div className="mt-4 space-y-2">
              {quiz.choices.map((choice, idx) => {
                const isSelected = selectedIndex === idx
                const isCorrect = idx === quiz.correctIndex
                let className = 'w-full text-left px-3 py-2 rounded-lg border transition-colors '
                if (submitted) {
                  if (isCorrect) {
                    className += 'border-green-500 bg-green-50 text-green-900'
                  } else if (isSelected) {
                    className += 'border-red-400 bg-red-50 text-red-900'
                  } else {
                    className += 'border-gray-200 bg-white text-gray-700'
                  }
                } else {
                  className += isSelected
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-900'
                    : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                }
                return (
                  <button
                    key={`${quiz.id}-${idx}`}
                    type="button"
                    disabled={submitted}
                    onClick={() => setSelectedIndex(idx)}
                    className={className}
                  >
                    {choice}
                  </button>
                )
              })}
            </div>
          )}

          {!quizComplete && submitted && (
            <div className="mt-4 text-sm">
              {selectedIsCorrect ? (
                <p className="text-green-700 font-medium">Correct! Nice one.</p>
              ) : (
                <p className="text-red-700 font-medium">
                  Not quite. Correct answer: <span className="font-semibold">{answerLabel}</span>
                </p>
              )}
              {quiz.explanation && <p className="text-gray-600 mt-1">{quiz.explanation}</p>}
            </div>
          )}

          {!quizComplete && (
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={handleCheckAnswer}
                disabled={selectedIndex === null || submitted}
                className="px-4 py-2 rounded-lg bg-[#404040] text-white text-sm font-medium disabled:opacity-50"
              >
                Check Answer
              </button>
              <button
                type="button"
                onClick={handleNextQuestion}
                disabled={!submitted}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Next Question
              </button>
            </div>
          )}

          {quizComplete && (
            <div className="mt-4 rounded-lg border border-indigo-200 bg-white p-4">
              <p className="text-lg font-semibold text-indigo-900">
                Quiz complete: {correctCount} / {QUIZ_BANK.length}
              </p>
              <p className="mt-2 text-sm text-gray-700">{scoreMessage}</p>
              <button
                type="button"
                onClick={handleRestartQuiz}
                className="mt-3 px-4 py-2 rounded-lg bg-[#404040] text-white text-sm font-medium"
              >
                Play Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
