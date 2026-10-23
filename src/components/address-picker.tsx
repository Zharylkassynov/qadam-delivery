'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { MapPoint } from '../lib/types';
import type { AddressResult } from '../lib/geocoding';
import { api } from '../lib/client-api';
import { serviceCity } from '../lib/service-area';
import { DeliveryMap } from './delivery-map';
import { AddressRow, Button, Feedback } from './delivery-ui';
import './address-picker.css';

export type AddressPickerMode = 'search' | 'map';
type Props = {
  address: string;
  kind: 'pickup' | 'destination';
  point: MapPoint | null;
  onChange: (point: MapPoint | null) => void;
  onAddress: (address: string) => void;
  mode: AddressPickerMode;
  onModeChange: (mode: AddressPickerMode) => void;
  pickupAddress?: string;
};

export function AddressPicker({ address, kind, point, onChange, onAddress, mode, onModeChange, pickupAddress }: Props) {
  const [query, setQuery] = useState(address);
  const [results, setResults] = useState<AddressResult[]>([]);
  const [selected, setSelected] = useState<AddressResult | null>(null);
  const [center, setCenter] = useState<MapPoint | undefined>(point ?? undefined);
  const [precision, setPrecision] = useState(point ? 'manual' : '');
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const initial = useRef({ address, point, mode });
  const validQuery = query.trim().length >= 5 && query.trim().length <= 200;

  function choose(result: AddressResult) {
    setCenter(result); setSelected(result); setPrecision(result.precision);
    const fullAddress = result.fullAddress || `${result.address}, ${result.detail}`;
    const label = fullAddress.length <= 200 ? fullAddress : result.address.length <= 200 ? result.address : query.trim();
    setQuery(label); onAddress(label);
    onChange(result.precision === 'building' ? { latitude: result.latitude, longitude: result.longitude } : null);
    if (result.precision !== 'building') onModeChange('map');
  }

  async function search(value: string) {
    const trimmed = value.trim();
    if (trimmed.length < 5 || trimmed.length > 200) return;
    request.current?.abort(); const current = ++generation.current;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setSearched(false); setResults([]); setSelected(null); setError(''); setPrecision(''); onChange(null);
    try {
      const data = await api<{ results: AddressResult[] }>('/api/geocoding', { query: trimmed }, controller.signal);
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
    const timer = setTimeout(() => {
      if (current === generation.current && initial.current.mode === 'search' && !initial.current.point) void search(initial.current.address);
    }, 100);
    return () => { clearTimeout(timer); generation.current++; request.current?.abort(); };
    // Search once on entering this screen; subsequent searches require submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function submit(event: FormEvent) { event.preventDefault(); if (validQuery) void search(query); }
  function openMap() {
    generation.current++; request.current?.abort(); setBusy(false); setError('');
    if (!precision) setPrecision('manual');
    onModeChange('map');
  }

  if (mode === 'map') return <div className="address-picker address-picker-map">
    <h1 className="sr-only" tabIndex={-1}>Уточните точку {kind === 'pickup' ? 'А' : 'Б'}</h1>
    <div className="address-picker-map-view"><DeliveryMap key={`${center?.latitude ?? ''},${center?.longitude ?? ''}`} center={center} markers={point ? [{ ...point, kind, label: query }] : []} onPick={(next) => { setPrecision('manual'); setSelected(null); onChange(next); }}/></div>
    <section className="address-picker-map-panel" aria-label="Проверка точки">
      <h2>Где встретить курьера?</h2>
      <AddressRow kind={kind} address={query}/>
      <p>Нажмите на карту или переместите её и выберите точку в центре, чтобы указать место у дома или подъезда.</p>
      {precision === 'street' || precision === 'area' ? <Feedback tone="warning" title="Дом не определён">Показана {precision === 'street' ? 'улица' : 'область поиска'}. Уточните место у нужного дома.</Feedback> : <p className="address-picker-hint" role="status">{point ? 'Точка выбрана. Проверьте её перед подтверждением.' : 'Выберите точку, чтобы подтвердить её.'}</p>}
      <button className="text-button address-picker-return" type="button" onClick={() => onModeChange('search')}>Вернуться к поиску</button>
      <p className="address-picker-hint">В поиске можно выбрать текстовый адрес без точки на карте.</p>
    </section>
  </div>;

  const hasSelectedAddress = !!point && validQuery;
  return <div className="address-picker address-picker-search">
    <h1 className="sr-only" tabIndex={-1}>{kind === 'pickup' ? 'Откуда забрать?' : 'Куда доставить?'}</h1>
    {kind === 'destination' && pickupAddress?.trim() ? <section className="address-picker-pickup" aria-label="Выбранный адрес отправления"><AddressRow kind="pickup" address={pickupAddress}/><div className="divider"/></section> : <div className="field"><label htmlFor="address-city">Город</label><input id="address-city" value={serviceCity} readOnly/></div>}
    <form onSubmit={submit} className="address-picker-query">
      <div className="field"><label htmlFor="address-query">Улица и дом</label><div className="address-picker-input-wrap"><input id="address-query" aria-label={kind === 'pickup' ? 'Адрес отправления' : 'Адрес доставки'} value={query} maxLength={200} minLength={5} required autoComplete="off" enterKeyHint="search" placeholder="Например, проспект Абая, 10" onChange={(event) => {
        generation.current++; request.current?.abort(); setBusy(false); setError(''); setSearched(false); setResults([]); setSelected(null); setCenter(undefined);
        setQuery(event.target.value); onAddress(event.target.value); onChange(null); setPrecision('');
      }}/><Button variant="ghost" type="submit" className="address-picker-search-action" disabled={busy || !validQuery} aria-label={busy ? 'Ищем адрес' : 'Найти адрес'}>{busy ? 'Поиск…' : 'Найти'}</Button></div></div>
    </form>
    {busy && <p role="status" className="address-picker-hint">Ищем адрес…</p>}
    {error && <Feedback tone="warning" title="Поиск недоступен" role="alert">{error} Можно продолжить с текстовым адресом или выбрать точку на карте.</Feedback>}
    {hasSelectedAddress ? <section className="address-picker-selected" aria-label="Выбранный адрес"><h2>{selected?.precision === 'building' ? 'Найденный адрес' : 'Выбранный адрес'}</h2><AddressRow kind={kind} address={selected?.address ?? query}/>{selected?.detail && <p className="address-picker-hint">{selected.detail}</p>}<div className="divider"/></section> : results.length > 0 && <section className="address-picker-result-list" aria-label="Результаты поиска адреса"><h2>Выберите подходящий адрес</h2>{results.map((result) => <button className="address-picker-result" type="button" key={result.id} onClick={() => choose(result)}><AddressRow kind={kind} address={result.address}/><span>{result.detail}</span><small>{result.precision === 'building' ? 'Найден дом' : result.precision === 'street' ? 'Только улица — уточните дом на карте' : 'Найден район — уточните дом на карте'}</small></button>)}</section>}
    {searched && !results.length && <Feedback title="Адрес не найден">Проверьте улицу и номер дома. Можно продолжить с текстовым адресом или указать точку на карте.</Feedback>}
    <Button variant="secondary" className="wide" onClick={openMap} disabled={!validQuery}>{hasSelectedAddress ? 'Уточнить на карте' : 'Указать вручную на карте'}</Button>
    <p className="address-picker-hint">{hasSelectedAddress && kind === 'destination' ? 'Проверьте номер дома перед выбором.' : 'Нет подходящего результата? Введите адрес с номером дома вручную.'}</p>
    <p className="address-picker-attribution">Поиск по Алматы и окрестностям · <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Geoapify</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a></p>
  </div>;
}
