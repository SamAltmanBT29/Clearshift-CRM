import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SEARCH_DEBOUNCE_MS } from '../../table/SearchFilterController.js';

export interface SearchInputProps {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  debounceMs?: number;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onClear?: () => void;
  id?: string;
  className?: string;
  autoFocus?: boolean;
}

/**
 * Accessible, 300ms debounced search input component.
 * Conforms to ClearShift V1 Issue #171 (CRM4-18).
 */
export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  defaultValue = '',
  placeholder = 'Search by name, audience, or key...',
  debounceMs = SEARCH_DEBOUNCE_MS,
  onChange,
  onSubmit,
  onClear,
  id = 'cs-search-input',
  className = '',
  autoFocus = false,
}) => {
  const [inputValue, setInputValue] = useState<string>(value ?? defaultValue);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUserTyping = useRef(false);

  // Synchronize internal state with external value changes without triggering debounce
  useEffect(() => {
    if (value !== undefined) {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      isUserTyping.current = false;
      setInputValue(value);
    }
  }, [value]);

  // Debounced notification on user keystrokes only (300ms)
  useEffect(() => {
    if (!isUserTyping.current) {
      return;
    }

    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      isUserTyping.current = false;
      onChange?.(inputValue);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [inputValue, debounceMs, onChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    isUserTyping.current = true;
    setInputValue(e.target.value);
  };

  const handleClear = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    isUserTyping.current = false;
    setInputValue('');
    onChange?.('');
    onClear?.();
  }, [onChange, onClear]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      isUserTyping.current = false;
      onChange?.(inputValue);
      onSubmit?.(inputValue);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleClear();
    }
  };

  return (
    <div className={`cs-search-bar ${className}`.trim()} role="search">
      <label htmlFor={id} className="cs-sr-only">
        Search records
      </label>
      <div className="cs-search-input-wrapper">
        <span className="cs-search-icon" aria-hidden="true">
          🔍
        </span>
        <input
          type="search"
          id={id}
          className="cs-search-input"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Search records"
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck="false"
        />
        {inputValue.length > 0 && (
          <button
            type="button"
            className="cs-search-clear-btn"
            onClick={handleClear}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
};
