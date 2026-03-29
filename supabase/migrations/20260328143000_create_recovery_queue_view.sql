create or replace view public.recovery_queue
with (security_invoker = true) as
with plan_price_stats as (
  select
    library_id,
    avg(price)::numeric as average_price
  from public.plans
  where is_active = true
  group by library_id
),
latest_period_end as (
  select distinct on (student_id)
    student_id,
    period_end
  from public.payments
  where period_end is not null
  order by student_id, created_at desc, id desc
),
payment_agg as (
  select
    student_id,
    coalesce(
      sum(
        case
          when lower(coalesce(status, '')) in ('approved', 'captured', 'completed', 'paid', 'success')
            then amount
          else 0
        end
      ),
      0
    )::numeric as amount_paid,
    count(*) filter (
      where lower(coalesce(status, '')) in ('approved', 'captured', 'completed', 'paid', 'success')
    )::integer as successful_payment_count,
    max(created_at) filter (
      where lower(coalesce(status, '')) in ('approved', 'captured', 'completed', 'paid', 'success')
    ) as last_payment_date
  from public.payments
  group by student_id
),
student_financials as (
  select
    s.library_id,
    s.id as student_id,
    s.full_name as student_name,
    s.phone,
    s.seat_number,
    coalesce(p.name, s.plan, 'Plan') as plan_name,
    s.slot as slot_label,
    coalesce(p.price, plan_price_stats.average_price, 0)::numeric as total_fees,
    coalesce(payment_agg.amount_paid, 0)::numeric as amount_paid,
    greatest(
      coalesce(p.price, plan_price_stats.average_price, 0)::numeric - coalesce(payment_agg.amount_paid, 0)::numeric,
      0
    )::numeric as amount_due,
    coalesce(latest_period_end.period_end, s.expiry_date, s.start_date) as due_date,
    coalesce(payment_agg.successful_payment_count, 0)::integer as successful_payment_count,
    payment_agg.last_payment_date
  from public.students s
  left join public.plans p
    on p.id = s.plan_id
  left join plan_price_stats
    on plan_price_stats.library_id = s.library_id
  left join payment_agg
    on payment_agg.student_id = s.id
  left join latest_period_end
    on latest_period_end.student_id = s.id
)
select
  student_financials.library_id,
  student_financials.student_id,
  student_financials.student_name,
  student_financials.phone,
  student_financials.seat_number,
  student_financials.plan_name,
  student_financials.slot_label,
  student_financials.total_fees,
  student_financials.amount_paid,
  student_financials.amount_due,
  student_financials.due_date,
  case
    when student_financials.amount_due > 0 and student_financials.due_date is not null
      then greatest((current_date - student_financials.due_date::date), 0)
    else 0
  end::integer as overdue_days,
  case
    when student_financials.amount_due <= 0 then 'paid'
    when student_financials.due_date is not null and student_financials.due_date::date < current_date then 'overdue'
    else 'pending'
  end as queue_status,
  case
    when student_financials.amount_due <= 0 then 'Paid'
    when student_financials.due_date is not null and student_financials.due_date::date < current_date then
      case
        when greatest((current_date - student_financials.due_date::date), 0) >= 7 then 'Seat cancellation warning'
        when greatest((current_date - student_financials.due_date::date), 0) >= 5 then 'Call alert'
        when greatest((current_date - student_financials.due_date::date), 0) >= 2 then 'Follow-up reminder'
        else 'WhatsApp reminder'
      end
    else 'Upcoming follow-up'
  end as recovery_urgency_label,
  student_financials.successful_payment_count,
  student_financials.last_payment_date
from student_financials;

grant select on public.recovery_queue to authenticated;
grant select on public.recovery_queue to service_role;
