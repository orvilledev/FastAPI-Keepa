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
    question: 'Which NBA franchise relocated to Oklahoma City and debuted as the Thunder in 2008?',
    choices: ['Seattle SuperSonics', 'Vancouver Grizzlies', 'Charlotte Hornets', 'New Orleans Hornets'],
    correctIndex: 0,
    explanation: 'The SuperSonics moved to OKC after the 2007–08 season and were renamed the Thunder.',
  },
  {
    id: 'q2',
    question: 'In which season did the Thunder first reach the NBA Finals?',
    choices: ['2008–09', '2009–10', '2011–12', '2015–16'],
    correctIndex: 2,
    explanation: 'OKC faced the Miami Heat in the 2012 NBA Finals.',
  },
  {
    id: 'q3',
    question: 'The Thunder lost the 2012 NBA Finals to which team?',
    choices: ['San Antonio Spurs', 'Miami Heat', 'Dallas Mavericks', 'Boston Celtics'],
    correctIndex: 1,
  },
  {
    id: 'q4',
    question: 'Which Thunder player won NBA MVP for the 2013–14 season?',
    choices: ['Russell Westbrook', 'Kevin Durant', 'James Harden', 'Paul George'],
    correctIndex: 1,
  },
  {
    id: 'q5',
    question: 'Which Thunder player won NBA MVP for the 2016–17 season?',
    choices: ['Kevin Durant', 'Paul George', 'Russell Westbrook', 'Chris Paul'],
    correctIndex: 2,
  },
  {
    id: 'q6',
    question: 'Who was the Thunder head coach when they went to the 2012 NBA Finals?',
    choices: ['Billy Donovan', 'Scott Brooks', 'Mark Daigneault', 'Nate McMillan'],
    correctIndex: 1,
  },
  {
    id: 'q7',
    question: 'OKC selected which player third overall in the 2009 NBA Draft?',
    choices: ['Russell Westbrook', 'James Harden', 'Serge Ibaka', 'Steven Adams'],
    correctIndex: 1,
    explanation: 'The Thunder took James Harden with the third pick in 2009.',
  },
  {
    id: 'q8',
    question: 'Which star guard became the face of the Thunder after the Paul George trade (2019)?',
    choices: ['Jamal Murray', 'Shai Gilgeous-Alexander', 'Andrew Wiggins', 'Fred VanVleet'],
    correctIndex: 1,
  },
  {
    id: 'q9',
    question: 'What is the current name of the Thunder home arena in Oklahoma City?',
    choices: ['Paycom Center', 'Crypto.com Arena', 'Moda Center', 'American Airlines Center'],
    correctIndex: 0,
  },
  {
    id: 'q10',
    question: 'Before becoming the Thunder, this franchise won the 1979 NBA title as which team?',
    choices: ['Buffalo Braves', 'Seattle SuperSonics', 'St. Louis Hawks', 'Washington Bullets'],
    correctIndex: 1,
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
  if (ratio >= 0.7) return '🎉 Great job! Strong score — your Thunder history game is sharp.'
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
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#81B81D]/20 text-[#111827] text-sm font-semibold">
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
