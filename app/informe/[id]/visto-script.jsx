'use client';

import { useEffect, useRef } from 'react';

/**
 * visto-script.jsx — Script del lado del navegador para la señal de permanencia y desplazamiento.
 *
 * REGLAS E INVARIANTES:
 * 1. NUNCA se dispara desde el servidor en el render de /informe/[id] (evita ráfagas de antivirus).
 * 2. Se dispara SOLO cuando se cumplen DOS condiciones:
 *    a) Permanencia mínima (10 segundos por defecto).
 *    b) Desplazamiento vertical >= 25% del alto de la página.
 * 3. Dispara la señal una sola vez por sesión del navegador mediante sessionStorage.
 */
export default function VistoScript({ leadId, segundosMinimos = 10 }) {
  const timerRef = useRef(null);
  const tiempoCumplidoRef = useRef(false);
  const scrollCumplidoRef = useRef(false);
  const disparadoRef = useRef(false);

  useEffect(() => {
    if (!leadId) return;

    const storageKey = `lokigi_visto_${leadId}`;
    if (typeof window !== 'undefined' && window.sessionStorage.getItem(storageKey)) {
      disparadoRef.current = true;
      return;
    }

    function evaluarYDisparar() {
      if (disparadoRef.current) return;
      if (tiempoCumplidoRef.current && scrollCumplidoRef.current) {
        disparadoRef.current = true;
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(storageKey, 'true');
        }

        fetch(`/api/informe/${encodeURIComponent(leadId)}/visto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {});
      }
    }

    // 1. Condición A: Permanencia mínima en segundos
    timerRef.current = setTimeout(() => {
      tiempoCumplidoRef.current = true;
      evaluarYDisparar();
    }, segundosMinimos * 1000);

    // 2. Condición B: Desplazamiento vertical >= 25%
    function handleScroll() {
      if (scrollCumplidoRef.current) return;
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (totalHeight <= 0) {
        scrollCumplidoRef.current = true;
      } else {
        const ratio = window.scrollY / totalHeight;
        if (ratio >= 0.25) {
          scrollCumplidoRef.current = true;
        }
      }
      evaluarYDisparar();
    }

    // Verificar scroll inicial por si la página ya carga abajo
    handleScroll();

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [leadId, segundosMinimos]);

  return null;
}
