
CREATE TABLE public.endpoint_field_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  action text NOT NULL,
  field_name text NOT NULL,
  is_mutable boolean NOT NULL DEFAULT false,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(action, field_name)
);

ALTER TABLE public.endpoint_field_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to endpoint_field_config" ON public.endpoint_field_config FOR ALL USING (true) WITH CHECK (true);

-- Seed: update_payment fields
INSERT INTO public.endpoint_field_config (action, field_name, is_mutable, description) VALUES
  ('update_payment', 'cod_payment', true, 'Наложный платеж (НП)'),
  ('update_payment', 'payment_type', true, 'Тип оплаты (1=отправитель, 2=получатель)'),
  ('update_payment', 'payment_method', true, 'Способ оплаты (4=нал, 2=безнал/каспи)'),
  ('update_payment', 'cash_sum', true, 'Сумма к оплате'),
  ('update_payment', 'declared_price', false, 'Объявленная стоимость'),
  ('update_payment', 'shipment_type', false, 'Тип перевозки (не менять!)'),
  ('update_payment', 'product_name', false, 'Название товара'),
  ('update_payment', 'annotation', false, 'Аннотация'),
  ('update_payment', 'period_id', false, 'ID периода'),
  ('update_payment', 'places', false, 'Кол-во мест'),
  ('update_payment', 'weight', false, 'Вес'),
  ('update_payment', 'width', false, 'Ширина'),
  ('update_payment', 'height', false, 'Высота'),
  ('update_payment', 'depth', false, 'Глубина'),
  ('update_payment', 'volume', false, 'Объём'),

  -- update_receiver fields
  ('update_receiver', 'phone', true, 'Телефон получателя'),
  ('update_receiver', 'full_name', true, 'ФИО получателя'),
  ('update_receiver', 'additional_phone', true, 'Доп. телефон получателя'),
  ('update_receiver', 'entity', true, 'Организация получателя'),
  ('update_receiver', 'city', true, 'Город получателя'),
  ('update_receiver', 'street', true, 'Улица получателя'),
  ('update_receiver', 'house', true, 'Дом получателя'),
  ('update_receiver', 'full_address', true, 'Полный адрес получателя'),
  ('update_receiver', 'zip_code', false, 'Индекс'),
  ('update_receiver', 'latitude', true, 'Широта'),
  ('update_receiver', 'longitude', true, 'Долгота'),
  ('update_receiver', 'city_id', true, 'ID города'),

  -- update_sender fields
  ('update_sender', 'phone', true, 'Телефон отправителя'),
  ('update_sender', 'full_name', true, 'ФИО отправителя'),
  ('update_sender', 'additional_phone', true, 'Доп. телефон отправителя'),
  ('update_sender', 'entity', true, 'Организация отправителя'),
  ('update_sender', 'city', true, 'Город отправителя'),
  ('update_sender', 'street', true, 'Улица отправителя'),
  ('update_sender', 'house', true, 'Дом отправителя'),
  ('update_sender', 'full_address', true, 'Полный адрес отправителя'),
  ('update_sender', 'latitude', true, 'Широта'),
  ('update_sender', 'longitude', true, 'Долгота'),
  ('update_sender', 'city_id', true, 'ID города'),

  -- change_direction fields
  ('change_direction', 'city', true, 'Город назначения'),
  ('change_direction', 'city_id', true, 'ID города'),

  -- change_sender_direction fields
  ('change_sender_direction', 'city', true, 'Город отправителя'),
  ('change_sender_direction', 'city_id', true, 'ID города'),
  ('change_sender_direction', 'phone', true, 'Телефон отправителя'),
  ('change_sender_direction', 'full_name', true, 'ФИО отправителя'),
  ('change_sender_direction', 'street', true, 'Улица отправителя'),
  ('change_sender_direction', 'house', true, 'Дом отправителя'),

  -- change_shipment_type fields
  ('change_shipment_type', 'shipment_type', true, 'Тип перевозки (1=авто, 2=авиа)');
