import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

describe('Button', () => {
  it('applies cursor-pointer for the global click affordance', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button')).toHaveClass('cursor-pointer');
  });

  it('applies cursor-not-allowed when disabled', () => {
    render(<Button disabled>Click me</Button>);
    expect(screen.getByRole('button')).toHaveClass('disabled:cursor-not-allowed');
  });

  it('the default variant fills with the solid pair, not --primary (white on --primary is 3.04:1)', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('bg-primary-solid', 'text-primary-solid-foreground', 'hover:bg-primary-solid-hover');
    expect(button.className).not.toMatch(/(^|\s)(bg-primary|text-primary-foreground)(\s|$)/);
    expect(button.className).not.toMatch(/hover:bg-primary\//);
  });

  it('other variants keep their own colours', () => {
    render(<Button variant="link">Link</Button>);
    expect(screen.getByRole('button')).toHaveClass('text-primary');
  });

  it('the default Badge uses the solid pair too', () => {
    render(<Badge>Beta</Badge>);
    expect(screen.getByText('Beta')).toHaveClass('bg-primary-solid', 'text-primary-solid-foreground');
  });
});
