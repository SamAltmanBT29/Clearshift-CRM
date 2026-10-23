import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'warning' | 'info' | 'success' | 'danger' | 'neutral' | 'stage';
  size?: 'sm' | 'md';
}

export function Badge({
  children,
  variant = 'neutral',
  size = 'md',
  className = '',
  ...props
}: BadgeProps) {
  const baseStyles = 'inline-flex items-center font-medium rounded-full';

  const sizeStyles = {
    sm: 'px-2 py-0.5 text-xs gap-1',
    md: 'px-2.5 py-1 text-xs gap-1.5',
  };

  const variantStyles = {
    warning: 'bg-amber-100 text-amber-900 border border-amber-300 font-semibold',
    info: 'bg-blue-50 text-blue-700 border border-blue-200',
    success: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    danger: 'bg-rose-50 text-rose-700 border border-rose-200',
    neutral: 'bg-slate-100 text-slate-700 border border-slate-200',
    stage: 'bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold',
  };

  return (
    <span
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
