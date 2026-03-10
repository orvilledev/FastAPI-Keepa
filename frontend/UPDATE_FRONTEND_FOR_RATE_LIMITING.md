# Frontend Rate Limiting Integration Guide

This guide shows how to handle rate limit (429) errors gracefully in the frontend.

## Overview

When the backend rate limiter is triggered, it returns a 429 status code with:
- Error details in the response body
- `Retry-After` header indicating when to retry
- Rate limit headers showing current usage

The frontend should:
1. Catch 429 errors
2. Display user-friendly messages
3. Implement exponential backoff for retries
4. Show rate limit information to users

## Implementation

### 1. Update API Service (`src/services/api.ts`)

Add rate limit error handling and retry logic to the Axios client:

```typescript
import axios, { AxiosError, AxiosRequestConfig } from 'axios'

// ... existing code ...

// Rate limit error handler
const handleRateLimitError = (error: AxiosError) => {
  if (error.response?.status === 429) {
    const retryAfter = error.response.headers['retry-after']
    const data = error.response.data as any

    // Create user-friendly error message
    const message = data?.message || 'Too many requests. Please slow down and try again.'
    const details = data?.details || ''
    const waitTime = retryAfter ? `Please wait ${retryAfter} seconds before trying again.` : ''

    throw new Error(`${message} ${details} ${waitTime}`.trim())
  }
}

// Add response interceptor for rate limiting
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    // Handle rate limit errors
    if (error.response?.status === 429) {
      handleRateLimitError(error)
    }

    // ... existing error handling ...
    return Promise.reject(error)
  }
)
```

### 2. Add Retry Logic with Exponential Backoff

Create a utility function for retrying requests:

```typescript
// src/utils/retryRequest.ts
import { AxiosRequestConfig } from 'axios'
import api from '../services/api'

interface RetryConfig extends AxiosRequestConfig {
  retryCount?: number
  maxRetries?: number
  retryDelay?: number
}

export const retryRequest = async <T>(
  config: RetryConfig,
  attempt = 0
): Promise<T> => {
  const maxRetries = config.maxRetries || 3
  const baseDelay = config.retryDelay || 1000

  try {
    const response = await api.request<T>(config)
    return response.data
  } catch (error: any) {
    const status = error.response?.status

    // Don't retry on 429 (rate limit) - user should wait
    if (status === 429) {
      throw error
    }

    // Retry on server errors (5xx) or network errors
    if (attempt < maxRetries && (status >= 500 || !status)) {
      const delay = baseDelay * Math.pow(2, attempt) // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay))
      return retryRequest<T>(config, attempt + 1)
    }

    throw error
  }
}
```

### 3. Create Rate Limit Toast/Notification

Add a specific toast notification for rate limit errors:

```typescript
// In your toast/notification utility
export const showRateLimitError = (retryAfter?: string) => {
  const message = retryAfter
    ? `Too many requests. Please wait ${retryAfter} seconds.`
    : 'Too many requests. Please slow down and try again shortly.'

  // Using your existing toast system
  toast.error(message, {
    duration: 5000,
    icon: '⚠️',
  })
}
```

### 4. Update Component Error Handling

Example of handling rate limits in a component:

```typescript
// src/components/notes/MyNotes.tsx (example)
const createNote = async (noteData: NoteCreate) => {
  try {
    const response = await api.post('/api/v1/notes', noteData)
    toast.success('Note created successfully')
    return response.data
  } catch (error: any) {
    if (error.response?.status === 429) {
      const retryAfter = error.response.headers['retry-after']
      showRateLimitError(retryAfter)
    } else if (error.response?.status === 401) {
      toast.error('Please log in to continue')
    } else {
      toast.error(error.message || 'Failed to create note')
    }
    throw error
  }
}
```

### 5. Display Rate Limit Information (Optional)

Show rate limit headers to users for transparency:

```typescript
// Extract rate limit info from response headers
const getRateLimitInfo = (headers: any) => {
  return {
    limit: headers['x-ratelimit-limit'],
    remaining: headers['x-ratelimit-remaining'],
    reset: headers['x-ratelimit-reset'],
  }
}

// Display in UI (optional)
<div className="rate-limit-info text-sm text-gray-500">
  {rateLimitInfo.remaining} / {rateLimitInfo.limit} requests remaining
</div>
```

### 6. Add Loading States for Slow Operations

For operations with strict rate limits (like job creation), show appropriate loading states:

```typescript
const [isCreating, setIsCreating] = useState(false)
const [cooldown, setCooldown] = useState(0)

const createJob = async (jobData: JobCreate) => {
  if (cooldown > 0) {
    toast.warning(`Please wait ${cooldown} seconds before creating another job`)
    return
  }

  setIsCreating(true)
  try {
    const response = await api.post('/api/v1/jobs', jobData)
    toast.success('Job created successfully')

    // Set cooldown after successful creation (10 jobs/hour = 6 minutes)
    setCooldown(360)
    const interval = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return response.data
  } catch (error: any) {
    if (error.response?.status === 429) {
      const retryAfter = parseInt(error.response.headers['retry-after'] || '60')
      setCooldown(retryAfter)
      showRateLimitError(String(retryAfter))
    } else {
      toast.error(error.message || 'Failed to create job')
    }
  } finally {
    setIsCreating(false)
  }
}
```

## Complete Example: Updated api.ts

Here's a complete example of updating the API service:

```typescript
// src/services/api.ts
import axios, { AxiosError } from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor for auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    // Handle rate limit errors (429)
    if (error.response?.status === 429) {
      const retryAfter = error.response.headers['retry-after']
      const data = error.response.data as any

      const message = data?.message || 'Too many requests. Please slow down.'
      const waitTime = retryAfter ? ` Please wait ${retryAfter} seconds.` : ''

      console.warn(`Rate limit exceeded: ${message}${waitTime}`)

      // You can dispatch a custom event here for global handling
      window.dispatchEvent(new CustomEvent('rate-limit-exceeded', {
        detail: { retryAfter, message: data?.message }
      }))
    }

    // Handle auth errors (401)
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }

    return Promise.reject(error)
  }
)

export default api
```

## Testing

To test rate limit handling:

1. **Trigger rate limit** by making rapid requests:
   ```typescript
   // In browser console
   for (let i = 0; i < 100; i++) {
     fetch('/api/v1/notes', {
       method: 'GET',
       headers: { Authorization: `Bearer ${token}` }
     })
   }
   ```

2. **Verify error handling**:
   - Check that 429 errors are caught
   - Verify user-friendly message is displayed
   - Confirm Retry-After header is respected

3. **Test cooldown periods**:
   - Verify cooldown timers work correctly
   - Check that buttons are disabled during cooldown

## User Experience Best Practices

1. **Clear Messages**: Show specific, actionable error messages
2. **Cooldown Indicators**: Display countdown timers for rate-limited actions
3. **Disable Buttons**: Prevent users from triggering rate limits
4. **Progressive Disclosure**: Only show rate limit info when relevant
5. **Graceful Degradation**: Continue to work even with rate limits

## Endpoints with Strict Rate Limits

Be especially careful with these endpoints:

| Endpoint | Limit | Strategy |
|----------|-------|----------|
| `POST /jobs` | 10/hour | Show cooldown timer, disable button |
| `POST /upcs/upload` | 10/hour | Warn before bulk upload |
| `POST /tasks/{id}/attachments` | 20/hour | Batch uploads, show progress |
| Auth endpoints | 5/minute | Use debouncing on login form |

## Summary Checklist

- ✅ Add 429 error handler to API interceptor
- ✅ Create rate limit toast notifications
- ✅ Implement cooldown timers for strict limits
- ✅ Update component error handling
- ✅ Add retry logic with exponential backoff
- ✅ Test all rate-limited endpoints
- ✅ Update user documentation

## Next Steps

1. Apply rate limit handling to all components
2. Add unit tests for rate limit scenarios
3. Monitor rate limit violations in production
4. Adjust frontend behavior based on user feedback
