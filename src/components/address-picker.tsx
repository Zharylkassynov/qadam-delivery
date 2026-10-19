'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { MapPoint } from '../lib/types';
import type { AddressResult } from '../lib/geocoding';
import { api } from '../lib/client-api';
import { DeliveryMap } from './delivery-map';
import { Button, Feedback } from './delivery-ui';

export function AddressPicker({ address, kind, point, onChange, onAddress }: { address: string; kind: 'pickup' | 'destination'; point: MapPoint | null; onChange: (point: MapPoint | null) => void; onAddress: (address: string) => void }) {
  const [query, setQuery] = useState(address);
  const [results, setResults] = useState<AddressResult[]>([]);
  const [mode, setMode] = useState<'search' | 'map'>(point ? 'map' : 'search');
  const [center, setCenter] = useState<MapPoint | undefined>(point ?? undefined);
  const [precision, setPrecision] = useState('');
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const initial = useRef({ address, point });
  function choose(result: AddressResult) {
    setCenter(result); setMode('map'); setPrecision(result.precision);
    const label = result.fullAddress || `${result.address}, ${result.detail}`;
    setQuery(label); onAddress(label);
    onChange(result.precision === 'building' ? { latitude: result.latitude, longitude: result.longitude } : null);
  }
  async function search(value: string) {
    request.current?.abort(); const current = ++generation.current;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setSearched(false); setResults([]); setError(''); setMode('search'); onChange(null);
    try {
      const data = await api<{ results: AddressResult[] }>('/api/geocoding', { query: value.trim() }, controller.signal);
      if (current !== generation.current) return;
      setResults(data.results); setSearched(true);
      if (data.results.length === 1 && data.results[0].precision === 'building') choose(data.results[0]);
    } catch (failure) {
      if (current === generation.current && !(failure instanceof Error && failure.name === 'AbortError')) setError(failure instanceof Error ? failure.message : 'Не удалось найти адрес.');
    } finally { if (current === generation.current) setBusy(false); }
  }
  useEffect(() => {
    // Delay until after Strict Mode's probe cleanup; never search on every keystroke.
    const current = generation.current;
    const timer = setTimeout(() => { if (current === generation.current && !initial.current.point) void search(initial.current.address); }, 100);
    return () => { clearTimeout(timer); generation.current++; request.current?.abort(); };
    // Search once on entering this screen; subsequent searches require submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function submit(event: FormEvent) { event.preventDefault(); if (query.trim().length >= 5 && query.trim().length <= 200) void search(query); }
  function manual() { generation.current++; request.current?.abort(); setBusy(false); setError(''); setMode('map'); setPrecision('manual'); }
  return <div className="form-fields address-picker">
    <div className="screen-heading"><h1 tabIndex={-1}>{mode === 'map' ? 'Проверьте точку' : 'Найдите адрес'}</h1><p>{mode === 'map' ? 'Проверьте дом и при необходимости уточните вход на карте.' : 'Введите улицу и дом. Поиск по Алматы и окрестностям.'}</p></div>
    <form className="form-fields" onSubmit={submit}>
      <div className="field"><label htmlFor="address-query">{kind === 'pickup' ? 'Адрес отправления' : 'Адрес доставки'}</label><input id="address-query" value={query} maxLength={200} minLength={5} required autoComplete="off" onChange={(event) => {
        generation.current++; request.current?.abort(); setBusy(false); setError(''); setSearched(false); setResults([]);
        setQuery(event.target.value); onAddress(event.target.value); onChange(null); setPrecision('manual');
      }}/><small className="field-hint">Квартиру, подъезд и домофон укажите в комментарии.</small></div>
      <Button variant="secondary" type="submit" className="wide" disabled={busy || query.trim().length < 5}>{busy ? 'Ищем адрес…' : 'Найти на карте'}</Button>
    </form>
    {busy && <p role="status" className="muted">Ищем улицу и дом…</p>}
    {error && <Feedback tone="warning" title="Поиск недоступен" role="alert">{error}</Feedback>}
    {mode === 'search' && results.length > 0 && <section className="address-results" aria-label="Результаты поиска адреса"><h2>Выберите подходящий адрес</h2>{results.map((result) => <button className="address-result" type="button" key={result.id} onClick={() => choose(result)}><strong>{result.address}</strong><span>{result.detail}</span><small>{result.precision === 'building' ? 'Найден дом' : result.precision === 'street' ? 'Только улица — уточните дом на карте' : 'Найден район — уточните дом на карте'}</small></button>)}</section>}
    {mode === 'search' && searched && !results.length && <Feedback title="Адрес не найден">Проверьте улицу и номер дома или укажите точку на карте вручную.</Feedback>}
    {mode === 'map' && <><DeliveryMap key={`${center?.latitude ?? ''},${center?.longitude ?? ''}`} center={center} markers={point ? [{ ...point, kind, label: query }] : []} onPick={(next) => { setPrecision('manual'); onChange(next); }}/>
      {precision === 'street' || precision === 'area' ? <Feedback tone="warning" title="Дом не определён">Показана {precision === 'street' ? 'улица' : 'область поиска'}. Укажите вход на карте, чтобы подтвердить точку.</Feedback> : <Feedback title={point ? precision === 'building' ? 'Дом найден автоматически' : 'Точка выбрана' : 'Выберите точку'}>{point ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}. Проверьте точку перед подтверждением.` : 'Нажмите на карту или выберите точку в центре.'}</Feedback>}</>}
    {mode !== 'map' && <Button variant="secondary" className="wide" onClick={manual}>Указать вручную на карте</Button>}
    {mode === 'search' && <p className="map-legend">Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Geoapify</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a></p>}
  </div>;
}
