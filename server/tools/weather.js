const API_KEY = process.env.OPENWEATHER_API_KEY;
const BASE_URL = 'https://api.openweathermap.org/data/2.5';

export async function getWeather(city, units = 'metric') {
  console.log('[tool] getWeather called:', city);

  if (!API_KEY) {
    return { error: 'OPENWEATHER_API_KEY не настроен в .env' };
  }

  try {
    const url = `${BASE_URL}/weather?q=${encodeURIComponent(city)}&units=${units}&lang=ru&appid=${API_KEY}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.cod !== 200) {
      return { error: data.message || 'Город не найден' };
    }

    return {
      city: data.name,
      country: data.sys?.country,
      temp: Math.round(data.main.temp),
      feels_like: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      pressure: data.main.pressure,
      wind_speed: data.wind.speed,
      description: data.weather[0]?.description,
      icon: data.weather[0]?.icon,
      updated_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[tool] getWeather error:', err.message);
    return { error: err.message };
  }
}