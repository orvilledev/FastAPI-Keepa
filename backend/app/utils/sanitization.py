"""Input sanitization utilities to prevent XSS and other injection attacks."""
import html
import bleach
from typing import Optional


# Allowed HTML tags for rich text content (ReactQuill)
ALLOWED_TAGS = [
    'p', 'br', 'strong', 'em', 'u', 'ol', 'ul', 'li', 'a',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'code', 'pre', 'span', 'div',
    'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td'
]

# Allowed HTML attributes
ALLOWED_ATTRIBUTES = {
    'a': ['href', 'title', 'target'],
    'img': ['src', 'alt', 'title', 'width', 'height'],
    'span': ['class', 'style'],
    'div': ['class', 'style'],
    'p': ['class', 'style'],
    'code': ['class'],
    'pre': ['class'],
    'table': ['class'],
}

# Allowed CSS properties (for inline styles)
ALLOWED_STYLES = [
    'color', 'background-color', 'font-size', 'font-weight', 'font-style',
    'text-align', 'text-decoration', 'margin', 'padding', 'border',
    'width', 'height'
]


def sanitize_html_content(content: str) -> str:
    """
    Sanitize HTML content to prevent XSS attacks.

    This is used for rich text content from ReactQuill editor.
    Preserves safe HTML tags and attributes while removing dangerous content.

    Args:
        content: Raw HTML content from user input

    Returns:
        Sanitized HTML content safe for storage and display

    Example:
        >>> sanitize_html_content('<script>alert("xss")</script><p>Safe content</p>')
        '<p>Safe content</p>'
    """
    if not content:
        return ""

    return bleach.clean(
        content,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        styles=ALLOWED_STYLES,
        strip=True  # Remove disallowed tags completely
    )


def sanitize_text_input(text: str) -> str:
    """
    Sanitize plain text input by escaping HTML entities.

    This is used for simple text fields like task titles, usernames, etc.
    Converts all HTML special characters to their entity equivalents.

    Args:
        text: Plain text input from user

    Returns:
        HTML-escaped text safe for display

    Example:
        >>> sanitize_text_input('<script>alert("xss")</script>')
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    """
    if not text:
        return ""

    return html.escape(text)


def sanitize_url(url: str) -> Optional[str]:
    """
    Sanitize and validate URLs to prevent javascript: and data: URI attacks.

    Args:
        url: URL from user input

    Returns:
        Sanitized URL or None if invalid/dangerous

    Example:
        >>> sanitize_url('javascript:alert("xss")')
        None
        >>> sanitize_url('https://example.com')
        'https://example.com'
    """
    if not url:
        return None

    # Remove whitespace
    url = url.strip()

    # Check for dangerous protocols
    dangerous_protocols = ['javascript:', 'data:', 'vbscript:', 'file:']
    url_lower = url.lower()

    for protocol in dangerous_protocols:
        if url_lower.startswith(protocol):
            return None

    # Only allow http, https, mailto protocols
    if not (url_lower.startswith('http://') or
            url_lower.startswith('https://') or
            url_lower.startswith('mailto:') or
            url_lower.startswith('/')):  # Relative URLs
        return None

    return url


def sanitize_filename(filename: str) -> str:
    """
    Sanitize filename to prevent directory traversal and other file system attacks.

    Args:
        filename: Original filename from user

    Returns:
        Safe filename with dangerous characters removed

    Example:
        >>> sanitize_filename('../../etc/passwd')
        'etcpasswd'
        >>> sanitize_filename('safe_file.txt')
        'safe_file.txt'
    """
    if not filename:
        return "unnamed"

    # Remove path separators and null bytes
    dangerous_chars = ['/', '\\', '\0', '..']
    safe_name = filename

    for char in dangerous_chars:
        safe_name = safe_name.replace(char, '')

    # Remove leading/trailing whitespace and dots
    safe_name = safe_name.strip().strip('.')

    # If nothing left, return default
    if not safe_name:
        return "unnamed"

    return safe_name


def sanitize_sql_like_pattern(pattern: str) -> str:
    """
    Escape special characters in SQL LIKE patterns.

    Args:
        pattern: Search pattern from user

    Returns:
        Escaped pattern safe for SQL LIKE queries

    Example:
        >>> sanitize_sql_like_pattern('test%_value')
        'test\\%\\_value'
    """
    if not pattern:
        return ""

    # Escape SQL LIKE special characters
    pattern = pattern.replace('\\', '\\\\')
    pattern = pattern.replace('%', '\\%')
    pattern = pattern.replace('_', '\\_')

    return pattern
