import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    // Check if it's an AbortError - if so, don't show error UI
    const errorName = error.name || error.constructor?.name || '';
    const errorMessage = error.message || error.toString() || '';

    if (
      errorName === 'AbortError' ||
      errorMessage.includes('aborted') ||
      errorMessage.includes('signal is aborted') ||
      errorMessage.includes('BodyStreamBuffer was aborted')
    ) {
      // Suppress AbortError - don't show error UI
      return { hasError: false };
    }

    // For other errors, show error UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Check if it's an AbortError - if so, don't log it
    const errorName = error.name || error.constructor?.name || '';
    const errorMessage = error.message || error.toString() || '';

    if (
      errorName === 'AbortError' ||
      errorMessage.includes('aborted') ||
      errorMessage.includes('signal is aborted') ||
      errorMessage.includes('BodyStreamBuffer was aborted')
    ) {
      // Silently suppress AbortError
      return;
    }

    // Log other errors
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Only show error UI for non-AbortError
      return (
        <div style={{ padding: '20px', color: 'red', border: '1px solid red', margin: '10px' }}>
          <h3>Something went wrong</h3>
          <p>Please refresh the page and try again.</p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;