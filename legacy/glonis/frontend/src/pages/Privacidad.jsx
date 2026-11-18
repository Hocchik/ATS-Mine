const ICON_URL = 'https://glonis.pe/cdn/shop/files/cloudio.webp?crop=center&height=32&v=1751428378&width=32';

export default function Privacidad() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-2">
        <img src={ICON_URL} alt="Glonis" className="w-7 h-7 rounded" />
        <p className="text-xs font-bold tracking-widest text-gray-900">GLONIS®</p>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Política de privacidad</h1>
        <p className="text-sm text-gray-400 mb-8">Tratamiento de datos personales de postulantes — última actualización: julio de 2026.</p>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6 text-sm text-gray-700 leading-relaxed">
          <section>
            <h2 className="font-semibold text-gray-900 mb-1.5">1. Responsable del tratamiento</h2>
            <p>Glonis ("nosotros") es el titular del banco de datos personales de postulantes generado a través de este formulario, conforme a la Ley N.º 29733, Ley de Protección de Datos Personales del Perú, y su reglamento.</p>
          </section>

          <section>
            <h2 className="font-semibold text-gray-900 mb-1.5">2. Datos que recogemos</h2>
            <p>Nombres y apellidos, DNI, correo electrónico, teléfono, distrito de residencia, disponibilidad horaria, respuestas al cuestionario de aptitud y el currículum vitae (CV) en formato PDF que adjuntas.</p>
          </section>

          <section>
            <h2 className="font-semibold text-gray-900 mb-1.5">3. Finalidad</h2>
            <p>Usamos estos datos exclusivamente para evaluar tu postulación a la vacante indicada: calcular un score de aptitud, contactarte para entrevistas y dar seguimiento a tu proceso de selección. No se usan para fines comerciales ni se comparten con terceros ajenos al proceso de selección de Glonis.</p>
          </section>

          <section>
            <h2 className="font-semibold text-gray-900 mb-1.5">4. Plazo de conservación</h2>
            <p>Conservamos tus datos mientras dure el proceso de selección y hasta 12 meses después de su cierre, por si surgen vacantes similares. Puedes solicitar su eliminación anticipada en cualquier momento (ver sección 6).</p>
          </section>

          <section>
            <h2 className="font-semibold text-gray-900 mb-1.5">5. Seguridad</h2>
            <p>Tu CV y datos personales se almacenan cifrados en tránsito (HTTPS) y solo son accesibles por personal autorizado de RRHH mediante autenticación. No publicamos ni compartimos tu información públicamente.</p>
          </section>

          <section>
            <h2 className="font-semibold text-gray-900 mb-1.5">6. Tus derechos (ARCO)</h2>
            <p>Tienes derecho de Acceso, Rectificación, Cancelación y Oposición sobre tus datos personales. Para ejercerlos, escríbenos a <a href="mailto:soporte@glonis.pe" className="text-indigo-600 hover:underline">soporte@glonis.pe</a> indicando tu nombre completo y el motivo de tu solicitud.</p>
          </section>

          <section>
            <h2 className="font-semibold text-gray-900 mb-1.5">7. Consentimiento</h2>
            <p>Al marcar la casilla de aceptación en el formulario de postulación, otorgas tu consentimiento previo, expreso e informado para el tratamiento de tus datos personales según lo descrito en esta política.</p>
          </section>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">© 2026 Glonis · Lima, Perú</p>
      </div>
    </div>
  );
}
