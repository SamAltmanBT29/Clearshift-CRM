import React from 'react';

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'info' | 'warning' | 'error' | 'success';
  title?: string;
  action?: React.ReactNode;
}

export function Alert({
  variant = 'info',
  title,
  children,
  action,
  className = '',
  ...props
}: AlertProps) {
  const variantStyles = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-amber-50 border-amber-300 text-amber-900',
    error: 'bg-rose-50 border-rose-300 text-rose-900',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  };

  return (
    <div
      role="alert"
      className={`rounded-lg border p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${variantStyles[variant]} ${className}`}
      {...props}
    >
      <div className="flex-1">
        {title && <h3 className="font-semibold text-sm mb-1">{title}</h3>}
        <div className="text-sm leading-relaxed">{children}</div>
      </div>
      {action && <div className="mt-2 sm:mt-0 flex-shrink-0">{action}</div>}
    </div>
  );
}
