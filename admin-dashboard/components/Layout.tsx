'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const navItems = [
    { href: '/', label: 'Dashboard' },
    { href: '/challenges', label: 'Challenges' },
    { href: '/users', label: 'Users' },
    { href: '/chains', label: 'Chains' },
    { href: '/authenticity-records', label: 'Authenticity Records' },
    { href: '/jobs', label: 'Jobs Queue' },
  ];

  const handleLogout = () => {
    fetch('/api/logout', { method: 'POST' })
      .then(() => window.location.href = '/')
      .catch(() => window.location.href = '/');
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <div className="w-64 bg-gray-900 text-white flex flex-col">
        <div className="p-6">
          <h1 className="text-2xl font-bold">TouchGrass Admin</h1>
        </div>
        <nav className="mt-8 flex-1">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-6 py-3 hover:bg-gray-800 transition ${
                pathname === item.href ? 'bg-gray-800 border-l-4 border-blue-500' : ''
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-6 border-t border-gray-800">
          <button
            onClick={handleLogout}
            className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 rounded transition"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 bg-gray-50">
        <div className="p-8">
          {children}
        </div>
      </div>
    </div>
  );
}