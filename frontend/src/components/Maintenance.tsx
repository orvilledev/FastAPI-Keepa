import { useMemo, useState } from 'react'

interface MaintenanceProps {
  title?: string
  message?: string
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

export default function Maintenance({ title = 'Quick Tune-Up in Progress', message }: MaintenanceProps) {
  const [askedIds, setAskedIds] = useState<string[]>([])
  const [quiz, setQuiz] = useState<QuizItem>(() => randomQuestion())
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)
  const [attemptCount, setAttemptCount] = useState(0)

  const selectedIsCorrect = submitted && selectedIndex === quiz.correctIndex
  const answerLabel = useMemo(() => quiz.choices[quiz.correctIndex], [quiz])

  const handleCheckAnswer = () => {
    if (selectedIndex === null || submitted) return
    setSubmitted(true)
    setAttemptCount((prev) => prev + 1)
    if (selectedIndex === quiz.correctIndex) {
      setCorrectCount((prev) => prev + 1)
    }
  }

  const handleNextQuestion = () => {
    const nextAsked = [...askedIds, quiz.id]
    setAskedIds(nextAsked.length >= QUIZ_BANK.length ? [] : nextAsked)
    setQuiz(randomQuestion(nextAsked))
    setSelectedIndex(null)
    setSubmitted(false)
  }

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
        </div>

        <div className="mt-8 border border-indigo-100 rounded-lg p-5 bg-indigo-50/40">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-lg font-semibold text-indigo-900">While You Wait: Quick Quiz</h2>
            <span className="text-xs font-medium text-indigo-700 bg-indigo-100 px-2 py-1 rounded">
              Score: {correctCount} / {attemptCount}
            </span>
          </div>

          <p className="text-gray-800 font-medium">{quiz.question}</p>

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

          {submitted && (
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

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleCheckAnswer}
              disabled={selectedIndex === null || submitted}
              className="px-4 py-2 rounded-lg bg-[#0B1020] text-white text-sm font-medium disabled:opacity-50"
            >
              Check Answer
            </button>
            <button
              type="button"
              onClick={handleNextQuestion}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
            >
              Next Question
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
