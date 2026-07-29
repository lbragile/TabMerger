import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('applies cursor-pointer for the global click affordance', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button')).toHaveClass('cursor-pointer');
  });

  it('applies cursor-not-allowed when disabled', () => {
    render(<Button disabled>Click me</Button>);
    expect(screen.getByRole('button')).toHaveClass('disabled:cursor-not-allowed');
  });
});
